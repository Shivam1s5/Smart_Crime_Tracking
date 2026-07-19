from app import app, db
from models import User, Complaint, CriminalRecord, Incident
from flask_bcrypt import Bcrypt

bcrypt = Bcrypt()

def seed_data():
    with app.app_context():
        db.drop_all()
        db.create_all()

        # Users
        admin_pw = bcrypt.generate_password_hash('admin123').decode('utf-8')
        police_pw = bcrypt.generate_password_hash('police123').decode('utf-8')
        citizen_pw = bcrypt.generate_password_hash('citizen123').decode('utf-8')

        admin = User(username='admin', password_hash=admin_pw, role='Admin')
        police = User(username='police', password_hash=police_pw, role='Police')
        citizen = User(username='citizen', password_hash=citizen_pw, role='Citizen')
        db.session.add_all([admin, police, citizen])
        db.session.commit()

        # Complaints
        complaints = [
            Complaint(citizen_id=citizen.id, description='Stolen bike near metro', location='Metro Station', lat=28.6200, lng=77.2100),
            Complaint(citizen_id=citizen.id, description='Suspicious gathering', location='Park', lat=28.6250, lng=77.2150),
            Complaint(citizen_id=citizen.id, description='Vandalism', location='Market', lat=28.6180, lng=77.2120),
        ]
        db.session.add_all(complaints)

        # Historical Incidents for Clustering
        incidents = [
            Incident(type='Robbery', lat=28.6201, lng=77.2101, confidence=0.9),
            Incident(type='Assault', lat=28.6205, lng=77.2110, confidence=0.85),
            Incident(type='Theft', lat=28.6300, lng=77.2200, confidence=0.95),
            Incident(type='Theft', lat=28.6310, lng=77.2210, confidence=0.8),
            Incident(type='Vandalism', lat=28.6400, lng=77.2300, confidence=0.7),
        ]
        db.session.add_all(incidents)

        # Criminal Records
        records = [
            CriminalRecord(name='John Doe', alias='JD', age=35, crimes='Theft, Assault', last_known_location='Old City'),
            CriminalRecord(name='Jane Smith', alias='Smitty', age=28, crimes='Cyber Fraud', last_known_location='Tech Park')
        ]
        db.session.add_all(records)

        db.session.commit()
        print("Database seeded successfully!")

if __name__ == '__main__':
    seed_data()
