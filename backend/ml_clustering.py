import numpy as np
from sklearn.cluster import KMeans
from models import Complaint, Incident, db

def calculate_risk_zones(n_clusters=3):
    # Fetch all locations from complaints and incidents
    complaints = Complaint.query.all()
    incidents = Incident.query.all()

    points = []
    for c in complaints:
        points.append([c.lat, c.lng])
    for i in incidents:
        points.append([i.lat, i.lng])
    
    if len(points) < n_clusters:
        return []

    X = np.array(points)
    kmeans = KMeans(n_clusters=n_clusters, random_state=42)
    kmeans.fit(X)

    # Calculate cluster density (points per cluster)
    labels = kmeans.labels_
    unique_labels, counts = np.unique(labels, return_counts=True)
    
    # Sort clusters by density to assign Red/Yellow/Green
    sorted_clusters = [label for _, label in sorted(zip(counts, unique_labels), reverse=True)]
    
    zones = []
    colors = ['red', 'yellow', 'green'] # Highest density = red
    
    for idx, cluster_label in enumerate(sorted_clusters):
        center = kmeans.cluster_centers_[cluster_label]
        color = colors[idx] if idx < len(colors) else 'green'
        
        # Calculate an approximate radius based on max distance to center for points in cluster
        cluster_points = X[labels == cluster_label]
        distances = np.linalg.norm(cluster_points - center, axis=1)
        radius = np.max(distances) * 111000 if len(distances) > 0 else 1000 # Rough conversion to meters

        zones.append({
            'lat': float(center[0]),
            'lng': float(center[1]),
            'riskLevel': color,
            'radius': max(float(radius), 500) # Minimum radius 500m
        })

    return zones
