from models import users_collection, criminal_records_collection, incidents_collection
from flask_bcrypt import Bcrypt
from flask import Flask

app = Flask(__name__)
bcrypt = Bcrypt(app)

def seed_db():
    print("Clearing old data...")
    users_collection.delete_many({})
    criminal_records_collection.delete_many({})
    incidents_collection.delete_many({})

    print("Seeding Police User...")
    police_pw = bcrypt.generate_password_hash("police123").decode('utf-8')
    users_collection.insert_one({'username': 'police', 'password_hash': police_pw, 'role': 'Police'})
    
    print("Seeding Citizen User...")
    citizen_pw = bcrypt.generate_password_hash("citizen123").decode('utf-8')
    users_collection.insert_one({'username': 'citizen', 'password_hash': citizen_pw, 'role': 'Citizen'})

    print("Seeding Criminal Records...")
    records = [
        {'name': 'John Doe', 'alias': 'The Ghost', 'crimes': 'Robbery, Assault', 'age': 35, 'last_known_location': 'Downtown'},
        {'name': 'Jane Smith', 'alias': 'Viper', 'crimes': 'Cybercrime, Fraud', 'age': 28, 'last_known_location': 'North Side'}
    ]
    criminal_records_collection.insert_many(records)

    print("Database seeded successfully with MongoDB!")

if __name__ == '__main__':
    seed_db()
