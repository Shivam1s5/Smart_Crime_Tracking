from flask_sqlalchemy import SQLAlchemy
from datetime import datetime

db = SQLAlchemy()

class User(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    username = db.Column(db.String(80), unique=True, nullable=False)
    password_hash = db.Column(db.String(128), nullable=False)
    role = db.Column(db.String(20), nullable=False) # 'Citizen', 'Police', 'Admin'
    created_at = db.Column(db.DateTime, default=datetime.utcnow)

class Complaint(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    citizen_id = db.Column(db.Integer, db.ForeignKey('user.id'), nullable=False)
    description = db.Column(db.Text, nullable=False)
    location = db.Column(db.String(200), nullable=False)
    lat = db.Column(db.Float, nullable=False)
    lng = db.Column(db.Float, nullable=False)
    status = db.Column(db.String(50), default='Pending') # Pending, Investigating, Resolved
    timestamp = db.Column(db.DateTime, default=datetime.utcnow)

class CriminalRecord(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(100), nullable=False)
    alias = db.Column(db.String(100))
    age = db.Column(db.Integer)
    crimes = db.Column(db.Text, nullable=False)
    last_known_location = db.Column(db.String(200))
    photo_url = db.Column(db.String(500))

class Incident(db.Model):
    # Incidents detected by ML or verified by Police
    id = db.Column(db.Integer, primary_key=True)
    type = db.Column(db.String(50), nullable=False) # 'Violence', 'Theft', etc.
    lat = db.Column(db.Float, nullable=False)
    lng = db.Column(db.Float, nullable=False)
    confidence = db.Column(db.Float)
    timestamp = db.Column(db.DateTime, default=datetime.utcnow)
