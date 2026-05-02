const firebaseConfig = {
  apiKey: "AIzaSyDpL4ZOiHA-f7XLpb2aIDOc4zIZ-Cc2v_I",
  authDomain: "russianmemory-dd163.firebaseapp.com",
  projectId: "russianmemory-dd163",
  storageBucket: "russianmemory-dd163.firebasestorage.app",
  messagingSenderId: "1073211490914",
  appId: "1:1073211490914:web:586afb2c45a064fb2ec73b"
};

firebase.initializeApp(firebaseConfig);
export const db = firebase.firestore();
