#include <NinjaIoT.h>
#include <ESP8266WiFi.h>
#include "entry2.h"


NinjaIoT iot;

int d = 0;

void setup() {
  Serial.begin(115200);

  WiFi.begin(wifiuser, pass);
  while (WiFi.status() != WL_CONNECTED) {
    Serial.print('.');
    delay(1000);
  }
  iot.connect(wifiuser, pass, uid);   //link: https://iot.roboninja.in/
 
}

void loop() {

  iot.ReadAll();

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

  iot.SyncIN("D1"); // Reading from IR sensor
  d = analogRead(A0); // Reading from ultrasound sensor
  iot.WriteVar("Distance", d);

  delay(1500); // Wait for 1.5 seconds before sending the next value
}
