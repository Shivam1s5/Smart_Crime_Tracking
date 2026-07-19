from flask import Flask, request, jsonify
from flask_cors import CORS
from flask_jwt_extended import JWTManager, create_access_token, jwt_required, get_jwt_identity, get_jwt
from flask_socketio import SocketIO
from flask_bcrypt import Bcrypt
from models import users_collection, complaints_collection, criminal_records_collection, parse_json
from ml_clustering import calculate_risk_zones
import os
from dotenv import load_dotenv
from datetime import datetime
from bson.objectid import ObjectId

load_dotenv()

app = Flask(__name__)
CORS(app)

app.config['JWT_SECRET_KEY'] = os.getenv('JWT_SECRET_KEY', 'super-secret-key-change-in-prod')
jwt = JWTManager(app)
socketio = SocketIO(app, cors_allowed_origins="*")
bcrypt = Bcrypt(app)

video_processor = None

@app.route('/api/auth/register', methods=['POST'])
def register():
    data = request.get_json()
    hashed_pw = bcrypt.generate_password_hash(data.get('password')).decode('utf-8')
    
    if users_collection.find_one({'username': data.get('username')}):
        return jsonify({'message': 'Username already exists'}), 400

    new_user = {
        'username': data.get('username'),
        'password_hash': hashed_pw,
        'role': data.get('role', 'Citizen')
    }
    users_collection.insert_one(new_user)
    
    return jsonify({'message': 'User created successfully'}), 201

@app.route('/api/auth/login', methods=['POST'])
def login():
    data = request.get_json()
    user = users_collection.find_one({'username': data.get('username')})

    if user and bcrypt.check_password_hash(user['password_hash'], data.get('password')):
        access_token = create_access_token(
            identity=str(user['_id']), 
            additional_claims={'role': user['role'], 'username': user['username']}
        )
        return jsonify({'token': access_token, 'role': user['role']}), 200

    return jsonify({'message': 'Invalid credentials'}), 401

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

# WebSocket connections
@socketio.on('connect')
def handle_connect():
    print('Client connected to WebSockets')

@socketio.on('disconnect')
def handle_disconnect():
    print('Client disconnected')

@app.route('/api/video/start', methods=['POST'])
@jwt_required()
def start_video():
    claims = get_jwt()
    if claims.get('role') not in ['Police', 'Admin']:
        return jsonify({'message': 'Unauthorized'}), 403
        
    global video_processor
    # if not video_processor:
    #     # Use 0 for webcam or a video file path
    #     video_processor = VideoProcessor(socketio, app, video_source=0) 
    # video_processor.start()
    return jsonify({"message": "Camera is currently disabled per user request"}), 200

if __name__ == '__main__':
    port = int(os.environ.get('PORT', 5000))
    socketio.run(app, host='0.0.0.0', port=port, allow_unsafe_werkzeug=True)
