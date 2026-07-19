from flask import Flask, request, jsonify
from flask_cors import CORS
from flask_jwt_extended import JWTManager, create_access_token, jwt_required, get_jwt_identity, get_jwt
from flask_socketio import SocketIO
from flask_bcrypt import Bcrypt
from models import db, User, Complaint, CriminalRecord, Incident
from ml_clustering import calculate_risk_zones
from ml_video import VideoProcessor

app = Flask(__name__)
app.config['SQLALCHEMY_DATABASE_URI'] = 'sqlite:///crime_tracker.db'
app.config['SQLALCHEMY_TRACK_MODIFICATIONS'] = False
app.config['JWT_SECRET_KEY'] = 'super-secret-key-change-in-prod'

CORS(app)
db.init_app(app)
jwt = JWTManager(app)
bcrypt = Bcrypt(app)
socketio = SocketIO(app, cors_allowed_origins="*")

video_processor = None

with app.app_context():
    db.create_all()

@app.route('/api/auth/register', methods=['POST'])
def register():
    data = request.get_json()
    username = data.get('username')
    password = data.get('password')
    role = data.get('role', 'Citizen')

    if User.query.filter_by(username=username).first():
        return jsonify({'message': 'Username already exists'}), 400

    hashed_password = bcrypt.generate_password_hash(password).decode('utf-8')
    new_user = User(username=username, password_hash=hashed_password, role=role)
    db.session.add(new_user)
    db.session.commit()

    return jsonify({'message': 'User created successfully'}), 201

@app.route('/api/auth/login', methods=['POST'])
def login():
    data = request.get_json()
    user = User.query.filter_by(username=data.get('username')).first()

    if user and bcrypt.check_password_hash(user.password_hash, data.get('password')):
        access_token = create_access_token(
            identity=str(user.id), 
            additional_claims={'role': user.role, 'username': user.username}
        )
        return jsonify({'token': access_token, 'role': user.role}), 200

    return jsonify({'message': 'Invalid credentials'}), 401

@app.route('/api/complaints', methods=['POST'])
@jwt_required()
def add_complaint():
    current_user_id = get_jwt_identity()
    claims = get_jwt()
    if claims.get('role') != 'Citizen':
        return jsonify({'message': 'Only citizens can file complaints'}), 403

    data = request.get_json()
    new_complaint = Complaint(
        citizen_id=int(current_user_id),
        description=data.get('description'),
        location=data.get('location'),
        lat=data.get('lat'),
        lng=data.get('lng')
    )
    db.session.add(new_complaint)
    db.session.commit()
    return jsonify({'message': 'Complaint registered successfully'}), 201

@app.route('/api/complaints', methods=['GET'])
@jwt_required()
def get_complaints():
    current_user_id = get_jwt_identity()
    claims = get_jwt()
    if claims.get('role') == 'Citizen':
        complaints = Complaint.query.filter_by(citizen_id=int(current_user_id)).all()
    else:
        complaints = Complaint.query.all()
    
    return jsonify([{
        'id': c.id, 'description': c.description, 'location': c.location, 
        'status': c.status, 'timestamp': c.timestamp.isoformat()
    } for c in complaints]), 200

@app.route('/api/zones', methods=['GET'])
@jwt_required()
def get_zones():
    claims = get_jwt()
    if claims.get('role') != 'Police' and claims.get('role') != 'Admin':
        return jsonify({'message': 'Unauthorized'}), 403
    
    zones = calculate_risk_zones(n_clusters=3)
    return jsonify(zones), 200

@app.route('/api/records/search', methods=['GET'])
@jwt_required()
def search_records():
    claims = get_jwt()
    if claims.get('role') != 'Police' and claims.get('role') != 'Admin':
        return jsonify({'message': 'Unauthorized'}), 403

    query = request.args.get('q', '')
    records = CriminalRecord.query.filter(CriminalRecord.name.contains(query) | CriminalRecord.alias.contains(query)).all()
    return jsonify([{
        'id': r.id, 'name': r.name, 'alias': r.alias, 'crimes': r.crimes,
        'age': r.age, 'last_known_location': r.last_known_location
    } for r in records]), 200

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
    if claims.get('role') != 'Police' and claims.get('role') != 'Admin':
        return jsonify({'message': 'Unauthorized'}), 403
        
    global video_processor
    # if not video_processor:
    #     # Use 0 for webcam or a video file path
    #     video_processor = VideoProcessor(socketio, app, video_source=0) 
    # video_processor.start()
    return jsonify({"message": "Camera is currently disabled per user request"}), 200

if __name__ == '__main__':
    socketio.run(app, debug=True, port=5000, allow_unsafe_werkzeug=True)
