// scripts/send-fcm-test.js
import dotenv from 'dotenv';
dotenv.config();
import initFirebase from '../src/utils/firebaseAdmin.js';

async function main() {
  try {
    const admin = initFirebase();
    if (!admin) {
      throw new Error('Firebase not configured. Set SERVICE_ACCOUNT_KEY_BASE64 or SERVICE_ACCOUNT_PATH or GOOGLE_APPLICATION_CREDENTIALS.');
    }

    const token = 'ekEbl4OYSQaGqbbosQ3KSt:APA91bE2OcLvTXU9FwujN3tEfYrZnEt26hKh8H5oEC6lszlwMtstlz3LEyRGgZTc5SSLh7MvVvs5yhtfneJQN4g8j9N_HHQhTkAV1MGA8bBUzm3wPdMYOJ4';
    const message = {
      token,
      notification: {
        title: 'Test notification',
        body: 'Hello @⁨~iamthecodemonk⁩ — this is a test from Rijhub server'
      },
      data: {
        source: 'rijhub-test',
        timestamp: String(Date.now())
      }
    };

    // send single message
    const res = await admin.messaging().send(message);
    console.log('Sent message id:', res);
    process.exit(0);
  } catch (err) {
    console.error('FCM send failed:', err);
    process.exit(1);
  }
}

main();