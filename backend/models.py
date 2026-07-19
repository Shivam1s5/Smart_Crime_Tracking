from pymongo import MongoClient
from bson.objectid import ObjectId
from datetime import datetime
import os
from dotenv import load_dotenv

load_dotenv()

MONGO_URI = os.getenv('MONGO_URI')
client = MongoClient(MONGO_URI)
db = client['smart_crime_db']

# Collections
users_collection = db['users']
complaints_collection = db['complaints']
criminal_records_collection = db['criminal_records']
incidents_collection = db['incidents']

# Helper functions for models can be added here if needed
def parse_json(data):
    """Helper to convert ObjectId to string for JSON serialization"""
    import json
    from bson import json_util
    return json.loads(json_util.dumps(data))
