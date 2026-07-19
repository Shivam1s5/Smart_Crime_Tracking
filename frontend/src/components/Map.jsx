import React, { useEffect, useState } from 'react';
import { MapContainer, TileLayer, Circle, Popup } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import axios from 'axios';

export default function RiskMap() {
  const [zones, setZones] = useState([]);

  useEffect(() => {
    fetchZones();
  }, []);

  const fetchZones = async () => {
    try {
      const res = await axios.get('http://localhost:5000/api/zones');
      setZones(res.data);
    } catch (err) {
      console.error(err);
    }
  };

  return (
    <div style={{ height: '100%', width: '100%', borderRadius: '12px', overflow: 'hidden' }}>
      <MapContainer 
        center={[28.6139, 77.2090]} // New Delhi default
        zoom={12} 
        style={{ height: '100%', width: '100%' }}
        zoomControl={false}
      >
        <TileLayer
          url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
          attribution='&copy; OpenStreetMap contributors &copy; CARTO'
        />
        
        {zones.map((zone, idx) => {
          // Color mapping
          const colorMap = {
            'red': '#ef4444',
            'yellow': '#f59e0b',
            'green': '#10b981'
          };
          
          return (
            <Circle
              key={idx}
              center={[zone.lat, zone.lng]}
              radius={zone.radius}
              pathOptions={{
                color: colorMap[zone.riskLevel],
                fillColor: colorMap[zone.riskLevel],
                fillOpacity: 0.4,
                weight: 2
              }}
            >
              <Popup>
                <strong>{zone.riskLevel.toUpperCase()} ZONE</strong><br/>
                Radius: {Math.round(zone.radius)}m
              </Popup>
            </Circle>
          );
        })}
      </MapContainer>
    </div>
  );
}
