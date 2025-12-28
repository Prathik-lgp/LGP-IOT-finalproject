# **ParqSpace**

## **Stack**
Python Flask backend
HTML/CSS/JS frontend
Chart.js for heatmap
RandomForest for prediction
IoT API for distance readings

Readings taken from wemos mini r2 d1 which updates parking status in a web dashboard. Also checks for no parking zone violation and sends alert accordingly. Hardware used other than the wifi module: IR sensor and Ultrasound sensor. RandomForest ML model predicts future slot status based on time and past patterns. Uses render to host the web dashboard.

## **Instructions to use**

1. Clone repo
git clone <repo-url>
cd project-folder

2. Install dependencies
pip install -r requirements.txt

3. Run Flask server
python app.py

4. Open browser
http://127.0.0.1:5000/

## Deployment (Render)
1. Create a new Web Service
2. Connect GitHub repository
3. Add Python build
4. Add environment variables:
    BASE_URL
    UID

## Set Start Command:
gunicorn app:app

## **Notes**
Prediction may vary due a small dataset taken using roboninja iot API
Set threshold for ultrasonic sensor manually

## **Circuit diagram**
![alt text](image-1.png)

## **Link to my dashboard**
*https://parqspace.onrender.com/*

## **Link to video expaination of web dashboard**
*https://www.canva.com/design/DAG5gHksr_w/vqsRjYZQ0yLiN34shroP6A/watch?utm_content=DAG5gHksr_w&utm_campaign=designshare&utm_medium=link2&utm_source=uniquelinks&utlId=h2222db4115*
