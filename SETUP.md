# Setup Instructions

## 1. Firebase

1. Go to [Firebase Console](https://console.firebase.google.com/)
2. Create a new project (or use an existing one)
3. Add a **Web app** to the project
4. Copy the config values into `js/firebase.js` — replace all the `"REPLACE_ME"` strings
5. In Firestore → Rules, set:
   ```
   rules_version = '2';
   service cloud.firestore {
     match /databases/{database}/documents {
       match /{document=**} {
         allow read;
         allow write: if false; // writes handled via Admin only (no auth needed for family use)
       }
     }
   }
   ```
   Or for simplest setup (fine for private family use), allow all reads/writes:
   ```
   allow read, write: if true;
   ```

## 2. Admin Password

Open `js/pages/admin.js` and change the line:
```js
const ADMIN_PASSWORD = 'russian123';
```
to whatever password you want.

## 3. Deploy to Vercel

1. Push this repo to GitHub
2. Go to [vercel.com](https://vercel.com), import the repo
3. No build settings needed — it's a static site
4. Vercel will give you a public URL to share on any device

## 4. Browser Support

Speech recognition works best in **Chrome** or **Edge** (on phone or desktop).
Safari has partial support. Firefox does not support Web Speech API.
