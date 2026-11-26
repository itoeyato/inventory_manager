// Import the functions you need from the SDKs you need
import { initializeApp } from "firebase/app";
import { getAnalytics } from "firebase/analytics";
// TODO: Add SDKs for Firebase products that you want to use
// https://firebase.google.com/docs/web/setup#available-libraries

// Your web app's Firebase configuration
// For Firebase JS SDK v7.20.0 and later, measurementId is optional
const firebaseConfig = {
  apiKey: "AIzaSyC12ug2JtnSSpP2Z9WkEdFh-gKKieL63Gg",
  authDomain: "inventario-2b099.firebaseapp.com",
  projectId: "inventario-2b099",
  storageBucket: "inventario-2b099.firebasestorage.app",
  messagingSenderId: "252261677777",
  appId: "1:252261677777:web:0a2f477e7a76610b3e63f0",
  measurementId: "G-P8C4QNNG2J"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const analytics = getAnalytics(app);