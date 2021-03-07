import React from 'react';
import ReactDOM from 'react-dom';
import './index.css';
import './dark-theme.css';
import App from './App';
import reportWebVitals from './reportWebVitals';

// Wait for the deviceready event before using any of Cordova's device APIs.
// See https://cordova.apache.org/docs/en/latest/cordova/events/events.html#deviceready
document.addEventListener('deviceready', onDeviceReady, false);

function onDeviceReady() {
  const cordova = window.cordova
  // Cordova is now initialized. Have fun!
  console.log('Running cordova-' + cordova.platformId + '@' + cordova.version);
  const options = {
    text: 'mining',
    sticky: true,
    foreground: true,
  };
  cordova.plugins.backgroundMode.setDefaults(options)
  cordova.plugins.backgroundMode.enable()
  cordova.plugins.backgroundMode.on('activate', () => {
    console.log('background mode activated !!!');
    cordova.plugins.backgroundMode.disableWebViewOptimizations();
    cordova.plugins.backgroundMode.disableBatteryOptimizations(); 
  })
  document.getElementById('deviceready').classList.add('ready');
}

ReactDOM.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
  document.getElementById('root')
);

// If you want to start measuring performance in your app, pass a function
// to log results (for example: reportWebVitals(console.log))
// or send to an analytics endpoint. Learn more: https://bit.ly/CRA-vitals
reportWebVitals();
