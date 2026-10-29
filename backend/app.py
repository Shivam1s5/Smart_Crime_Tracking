from flask import Flask, request, jsonify
from flask_cors import CORS
from flask_jwt_extended import JWTManager, create_access_token, jwt_required, get_jwt_identity, get_jwt
from flask_socketio import SocketIO
from flask_bcrypt import Bcrypt
from models import users_collection, complaints_collection, criminal_records_collection, cameras_collection, alerts_collection, parse_json
from ml_clustering import calculate_risk_zones
import os
from dotenv import load_dotenv
from datetime import datetime, timedelta
import time
from bson.objectid import ObjectId
import cloudinary
import cloudinary.uploader

load_dotenv()

app = Flask(__name__)
CORS(app)

app.config['JWT_SECRET_KEY'] = os.getenv('JWT_SECRET_KEY', 'super-secret-key-change-in-prod')
app.config['JWT_ACCESS_TOKEN_EXPIRES'] = timedelta(hours=24)
jwt = JWTManager(app)
socketio = SocketIO(app, cors_allowed_origins="*")
bcrypt = Bcrypt(app)

# Cloudinary Config
cloudinary.config(
  cloud_name = os.environ.get('CLOUDINARY_CLOUD_NAME', 'dhkda169o'),
  api_key = os.environ.get('CLOUDINARY_API_KEY', '744382239968817'),
  api_secret = os.environ.get('CLOUDINARY_API_SECRET', 'L-sEHvzOSxh6pcOZnyt-WQMjphI')
)

video_processor = None

@app.route('/api/auth/register', methods=['POST'])
def register():
    try:
        data = request.get_json()
        hashed_pw = bcrypt.generate_password_hash(data.get('password')).decode('utf-8')
        
        if users_collection.find_one({'username': data.get('username')}):
            return jsonify({'message': 'Username already exists'}), 400

        role = data.get('role', 'Police')
        if role not in ['Police', 'Admin']:
            role = 'Police'

        # Restrict Admin registration to authorized team members with secret key
        if role == 'Admin':
            admin_key = data.get('admin_key', '')
            expected_key = os.getenv('ADMIN_SECRET_KEY', 'SCT-COMMAND-2026-ROOT')
            if not admin_key or admin_key.strip() != expected_key.strip():
                return jsonify({
                    'message': 'Unauthorized: Invalid Admin Security Authorization Key. Only authorized core team members can register as Administrator.'
                }), 403

        new_user = {
            'username': data.get('username'),
            'password_hash': hashed_pw,
            'role': role
        }
        users_collection.insert_one(new_user)
        
        return jsonify({'message': 'User created successfully'}), 201
    except Exception as e:
        print(f"Error in register: {e}")
        return jsonify({'error': str(e)}), 500

@app.route('/api/auth/login', methods=['POST'])
def login():
    try:
        data = request.get_json()
        user = users_collection.find_one({'username': data.get('username')})

        if user and bcrypt.check_password_hash(user['password_hash'], data.get('password')):
            access_token = create_access_token(
                identity=str(user['_id']), 
                additional_claims={'role': user['role'], 'username': user['username']}
            )
            return jsonify({'token': access_token, 'role': user['role']}), 200

        return jsonify({'message': 'Invalid credentials'}), 401
    except Exception as e:
        print(f"Error in login: {e}")
        return jsonify({'error': str(e)}), 500

@app.route('/api/complaints', methods=['POST'])
@jwt_required()
def add_complaint():
    current_user_id = get_jwt_identity()
    claims = get_jwt()
    if claims.get('role') != 'Citizen':
        return jsonify({'message': 'Only citizens can file complaints'}), 403

    data = request.get_json()
    new_complaint = {
        'citizen_id': current_user_id,
        'description': data.get('description'),
        'location': data.get('location'),
        'lat': data.get('lat'),
        'lng': data.get('lng'),
        'status': 'Pending',
        'timestamp': datetime.utcnow()
    }
    complaints_collection.insert_one(new_complaint)
    return jsonify({'message': 'Complaint registered successfully'}), 201

@app.route('/api/complaints', methods=['GET'])
@jwt_required()
def get_complaints():
    current_user_id = get_jwt_identity()
    claims = get_jwt()
    
    if claims.get('role') == 'Citizen':
        complaints = list(complaints_collection.find({'citizen_id': current_user_id}))
    else:
        complaints = list(complaints_collection.find())
    
    # Format for JSON
    for c in complaints:
        c['_id'] = str(c['_id'])
        c['timestamp'] = c['timestamp'].isoformat()
    
    return jsonify(complaints), 200

@app.route('/api/zones', methods=['GET'])
@jwt_required()
def get_zones():
    claims = get_jwt()
    if claims.get('role') not in ['Police', 'Admin']:
        return jsonify({'message': 'Unauthorized'}), 403
    
    zones = calculate_risk_zones(n_clusters=3)
    return jsonify(zones), 200

@app.route('/api/records/search', methods=['GET'])
@jwt_required()
def search_records():
    claims = get_jwt()
    if claims.get('role') not in ['Police', 'Admin']:
        return jsonify({'message': 'Unauthorized'}), 403

    query = request.args.get('q', '')
    
    records = list(criminal_records_collection.find({
        '$or': [
            {'name': {'$regex': query, '$options': 'i'}},
            {'alias': {'$regex': query, '$options': 'i'}}
        ]
    }))
    
    for r in records:
        r['_id'] = str(r['_id'])
        
    return jsonify(records), 200

# Real-time multi-device camera feed broadcast cache: camera_id -> feed_data
latest_camera_feeds = {}

# WebSocket connections
@socketio.on('connect')
def handle_connect():
    print('Client connected to WebSockets')

@socketio.on('disconnect')
def handle_disconnect():
    print('Client disconnected')

@socketio.on('broadcast_camera_frame')
def handle_broadcast_camera_frame(data):
    if not data or not isinstance(data, dict):
        return
    cam_id = data.get('camera_id')
    if cam_id:
        feed_info = {
            'camera_id': cam_id,
            'frame': data.get('frame'),
            'gathering_count': data.get('gathering_count', 0),
            'sound_level': data.get('sound_level', 0),
            'threat': data.get('threat', None),
            'area': data.get('area', ''),
            'timestamp': datetime.utcnow().isoformat()
        }
        latest_camera_feeds[cam_id] = feed_info
        # Relay live feed frame to all other connected clients (Police & Admin dashboards)
        socketio.emit('live_feed_update', feed_info, broadcast=True, include_self=False)

@app.route('/api/cameras/live_feeds', methods=['GET'])
@jwt_required()
def get_live_feeds():
    claims = get_jwt()
    if claims.get('role') not in ['Police', 'Admin']:
        return jsonify({'message': 'Unauthorized'}), 403
    return jsonify(latest_camera_feeds), 200

@app.route('/api/cameras', methods=['GET'])
@jwt_required()
def get_cameras():
    claims = get_jwt()
    if claims.get('role') not in ['Police', 'Admin']:
        return jsonify({'message': 'Unauthorized'}), 403
    
    area = request.args.get('area')
    query = {}
    if area:
        query['area'] = area
        
    cameras = list(cameras_collection.find(query))
    for c in cameras:
        c['_id'] = str(c['_id'])
        if 'gathering_threshold' not in c:
            c['gathering_threshold'] = 5
        if 'sound_threshold' not in c:
            c['sound_threshold'] = 75
        
    return jsonify(cameras), 200

@app.route('/api/cameras', methods=['POST'])
@jwt_required()
def add_camera():
    claims = get_jwt()
    if claims.get('role') not in ['Police', 'Admin']:
        return jsonify({'message': 'Unauthorized'}), 403
    
    data = request.get_json()
    try:
        threshold = max(1, int(data.get('gathering_threshold', 5)))
    except (ValueError, TypeError):
        threshold = 5

    try:
        sound_threshold = max(1, int(data.get('sound_threshold', 75)))
    except (ValueError, TypeError):
        sound_threshold = 75

    new_camera = {
        'camera_id': data.get('camera_id', f"CAM-{datetime.utcnow().timestamp()}"),
        'name': data.get('name'),
        'area': data.get('area', 'Custom Area'),
        'stream_url': data.get('stream_url'),
        'lat': data.get('lat'),
        'lng': data.get('lng'),
        'gathering_threshold': threshold,
        'sound_threshold': sound_threshold,
        'status': 'Active'
    }
    
    cameras_collection.insert_one(new_camera)
    new_camera['_id'] = str(new_camera['_id'])
    
    return jsonify({'message': 'Camera added successfully', 'camera': new_camera}), 201

@app.route('/api/cameras/<camera_id>', methods=['PUT'])
@jwt_required()
def update_camera(camera_id):
    claims = get_jwt()
    if claims.get('role') not in ['Police', 'Admin']:
        return jsonify({'message': 'Unauthorized'}), 403
    
    data = request.get_json() or {}
    update_fields = {}
    if 'gathering_threshold' in data:
        try:
            update_fields['gathering_threshold'] = max(1, int(data['gathering_threshold']))
        except (ValueError, TypeError):
            pass
    if 'sound_threshold' in data:
        try:
            update_fields['sound_threshold'] = max(1, int(data['sound_threshold']))
        except (ValueError, TypeError):
            pass
    if 'name' in data:
        update_fields['name'] = data['name']
    if 'area' in data:
        update_fields['area'] = data['area']
    if 'stream_url' in data:
        update_fields['stream_url'] = data['stream_url']
    if 'status' in data:
        update_fields['status'] = data['status']

    if not update_fields:
        return jsonify({'message': 'No fields provided to update'}), 400

    result = cameras_collection.update_one({'camera_id': camera_id}, {'$set': update_fields})
    updated = cameras_collection.find_one({'camera_id': camera_id})
    if updated:
        updated['_id'] = str(updated['_id'])
        if 'gathering_threshold' not in updated:
            updated['gathering_threshold'] = 5
        if 'sound_threshold' not in updated:
            updated['sound_threshold'] = 75
        socketio.emit('camera_updated', updated)
        return jsonify({'message': 'Camera updated successfully', 'camera': updated}), 200
    else:
        return jsonify({'message': 'Camera not found'}), 404

@app.route('/api/cameras/<camera_id>', methods=['DELETE'])
@jwt_required()
def delete_camera(camera_id):
    claims = get_jwt()
    if claims.get('role') not in ['Police', 'Admin']:
        return jsonify({'message': 'Unauthorized'}), 403
    
    # Gracefully remove local laptop webcam or virtual camera IDs
    if camera_id in ['CAM-LAPTOP', 'CAM-LAPTOP-LOCAL', 'default_local_cam'] or camera_id.startswith('CAM-LAPT'):
        cameras_collection.delete_many({'$or': [{'camera_id': camera_id}, {'stream_url': 'LOCAL_WEBCAM'}]})
        return jsonify({'message': 'Camera deleted successfully', 'deleted_count': 1}), 200

    query = {'camera_id': camera_id}
    if ObjectId.is_valid(camera_id):
        query = {'$or': [{'camera_id': camera_id}, {'_id': ObjectId(camera_id)}]}

    result = cameras_collection.delete_one(query)
    return jsonify({'message': 'Camera deleted successfully', 'deleted_count': result.deleted_count}), 200

@app.route('/api/users', methods=['GET'])
@jwt_required()
def get_users():
    claims = get_jwt()
    if claims.get('role') != 'Admin':
        return jsonify({'message': 'Unauthorized. Admin access required.'}), 403
    
    users = list(users_collection.find({}, {'password_hash': 0}))
    for u in users:
        u['_id'] = str(u['_id'])
    return jsonify(users), 200

@app.route('/api/alerts', methods=['GET'])
@jwt_required()
def get_alerts():
    claims = get_jwt()
    if claims.get('role') not in ['Police', 'Admin']:
        return jsonify({'message': 'Unauthorized'}), 403
        
    alerts = list(alerts_collection.find().sort('timestamp', -1).limit(50))
    for a in alerts:
        a['_id'] = str(a['_id'])
        if isinstance(a.get('timestamp'), datetime):
            a['timestamp'] = a['timestamp'].isoformat()
    return jsonify(alerts), 200

@app.route('/api/alerts/<alert_id>', methods=['DELETE'])
@jwt_required()
def delete_alert(alert_id):
    claims = get_jwt()
    if claims.get('role') not in ['Police', 'Admin']:
        return jsonify({'message': 'Unauthorized'}), 403
        
    alert = alerts_collection.find_one({'_id': ObjectId(alert_id)})
    if not alert:
        return jsonify({'message': 'Alert not found'}), 404
        
    # Delete image from Cloudinary
    if alert.get('public_id'):
        try:
            cloudinary.uploader.destroy(alert.get('public_id'))
        except Exception as e:
            print(f"Failed to delete from Cloudinary: {e}")
    elif alert.get('image_url') and 'cloudinary.com' in alert.get('image_url'):
        try:
            url_parts = alert['image_url'].split('/upload/')
            if len(url_parts) > 1:
                path_part = url_parts[1]
                if path_part.startswith('v') and '/' in path_part:
                    path_part = path_part.split('/', 1)[1]
                p_id = os.path.splitext(path_part)[0]
                cloudinary.uploader.destroy(p_id)
        except Exception as e:
            print(f"Failed to delete from Cloudinary by URL: {e}")
            
    alerts_collection.delete_one({'_id': ObjectId(alert_id)})
    return jsonify({'message': 'Alert deleted successfully'}), 200

# Server-side cooldown cache: (camera_id, alert_category) -> timestamp
alert_cooldowns = {}

@app.route('/api/alerts/trigger', methods=['POST'])
def trigger_alert():
    # This endpoint is called by the AI Microservice (or frontend now)
    data = request.get_json()
    
    if not data or 'camera_id' not in data:
        return jsonify({'error': 'Invalid payload'}), 400
        
    camera_id = data.get('camera_id')
    alert_type = (data.get('type') or 'SUSPICIOUS ACTIVITY').upper()

    # Categorize threat & determine cooldown window to prevent duplicate spamming
    if 'GATHERING' in alert_type or 'CROWD' in alert_type:
        category = 'CROWD'
        cooldown_sec = 45.0
    elif 'NOISE' in alert_type or 'AUDIO' in alert_type:
        category = 'NOISE'
        cooldown_sec = 40.0
    elif 'WEAPON' in alert_type or 'GUN' in alert_type or 'KNIFE' in alert_type:
        category = 'WEAPON'
        cooldown_sec = 18.0
    elif 'ASSAULT' in alert_type or 'PUNCH' in alert_type or 'COMBAT' in alert_type or 'BRAWL' in alert_type:
        category = 'COMBAT'
        cooldown_sec = 12.0
    else:
        category = 'GENERAL'
        cooldown_sec = 20.0

    now = time.time()
    cache_key = (camera_id, category)
    last_triggered = alert_cooldowns.get(cache_key, 0)

    if (now - last_triggered) < cooldown_sec:
        # Cleanly suppress duplicate notification
        return jsonify({
            'message': f'Alert suppressed by cooldown ({int(cooldown_sec - (now - last_triggered))}s remaining)',
            'suppressed': True
        }), 200

    alert_cooldowns[cache_key] = now
    
    image_base64 = data.get('image_base64')
    image_url = data.get('image_url', '')
    
    public_id = None
    if image_base64:
        try:
            upload_result = cloudinary.uploader.upload(image_base64, folder="smart_crime_tracking_alerts")
            image_url = upload_result.get("secure_url")
            public_id = upload_result.get("public_id")
        except Exception as e:
            print(f"Cloudinary Upload Error: {e}")
            
    new_alert = {
        'camera_id': data.get('camera_id'),
        'area': data.get('area', 'Unknown'),
        'type': data.get('type', 'Weapon Detected'),
        'confidence': data.get('confidence', 0.0),
        'image_url': image_url,
        'public_id': public_id,
        'timestamp': datetime.utcnow()
    }
    
    # Save to db
    alerts_collection.insert_one(new_alert)
    new_alert['_id'] = str(new_alert['_id'])
    new_alert['timestamp'] = new_alert['timestamp'].isoformat()
    
    # Broadcast to police dashboards via WebSocket
    socketio.emit('red_alert', new_alert)
    
    return jsonify({'message': 'Alert triggered successfully', 'alert': new_alert}), 201

@app.route('/api/video/start', methods=['POST'])
@jwt_required()
def start_video_processing():
    claims = get_jwt()
    if claims.get('role') not in ['Police', 'Admin']:
        return jsonify({'message': 'Unauthorized'}), 403
        
    return jsonify({'message': 'AI Background Monitoring Started Successfully'}), 200

if __name__ == '__main__':
    port = int(os.environ.get('PORT', 5000))
    socketio.run(app, host='0.0.0.0', port=port, allow_unsafe_werkzeug=True)
