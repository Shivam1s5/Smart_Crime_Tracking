@echo off
echo ========================================================
echo  Starting Smart Crime Tracking - Real-time YOLO Node
echo ========================================================
echo  Using Virtual Environment: ai_microservice\venv
echo  Connecting to Backend: http://localhost:5000
echo  Press Ctrl+C or 'q' to stop surveillance.
echo ========================================================

ai_microservice\venv\Scripts\python.exe ai_microservice\stream_worker.py --source 0 --backend http://localhost:5000 %*
pause
