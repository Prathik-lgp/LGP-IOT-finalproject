#include <NinjaIoT.h>
#include <ESP8266WiFi.h>
#include "entry2.h"


NinjaIoT iot;

const int trig = 14;
const int echo = 12;
float distance;
long duration;

void setup() {
  Serial.begin(115200);

  pinMode(trig, OUTPUT);
  pinMode(echo, INPUT);

  // wifi connection
  WiFi.begin(wifiuser, pass);
  while (WiFi.status() != WL_CONNECTED) {
    Serial.print('.');
    delay(1000);
  }
  iot.connect(wifiuser, pass, uid);   //link: https://iot.roboninja.in/
 
}

void loop() {

  iot.ReadAll();

  // wifi connecction
  if (WiFi.status() != WL_CONNECTED){
    Serial.print("Wifi disconnected. Reconnecting...");
    WiFi.begin(wifiuser, pass);
    unsigned long start = millis();
    while (WiFi.status() != WL_CONNECTED && millis() - start < 10000){
      delay(500);
      Serial.print(".");
    }
    if (WiFi.status() == WL_CONNECTED){
      Serial.println("Reconnected");
      iot.connect(wifiuser, pass, uid);
    }
    else{
      Serial.println("Reconnection failed");
    }
  }

  digitalWrite(trig, LOW);
  delayMicroseconds(2);
  digitalWrite(trig, HIGH);
  delayMicroseconds(10);
  digitalWrite(trig, LOW);

  duration = pulseIn(echo, HIGH);
  distance = (duration * 0.034) / 2;

  //Serial.println(duration);

  iot.SyncIN("D7"); // Reading from IR sensor
  iot.WriteVar("Distance1", distance);

  delay(1500); // Wait for 1.5 seconds before sending the next value
}
