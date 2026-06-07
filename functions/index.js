const functions = require('firebase-functions');
const admin     = require('firebase-admin');
const Razorpay  = require('razorpay');
const crypto    = require('crypto');

admin.initializeApp();

// ── Razorpay client (keys set via: firebase functions:config:set razorpay.key_id=... razorpay.key_secret=... razorpay.plan_id=... razorpay.webhook_secret=...)
function getRazorpay() {
  return new Razorpay({
    key_id:     functions.config().razorpay.key_id,
    key_secret: functions.config().razorpay.key_secret,
  });
}

// ── createSubscription ────────────────────────────────────────────────────────
// Called from the frontend when the user clicks Subscribe.
// Creates a Razorpay subscription and returns the subscription ID.
exports.createSubscription = functions.https.onCall(async (data, context) => {
  if (!context.auth) {
    throw new functions.https.HttpsError('unauthenticated', 'Login required.');
  }

  try {
    const razorpay = getRazorpay();
    const subscription = await razorpay.subscriptions.create({
      plan_id:         functions.config().razorpay.plan_id,
      customer_notify: 1,
      total_count:     12, // up to 12 monthly renewals
    });
    return { subscriptionId: subscription.id };
  } catch (err) {
    console.error('createSubscription error:', err);
    throw new functions.https.HttpsError('internal', 'Could not create subscription.');
  }
});

// ── verifySubscription ────────────────────────────────────────────────────────
// Called after Razorpay checkout succeeds.
// Verifies the HMAC signature, then marks the user as subscribed in Firestore.
exports.verifySubscription = functions.https.onCall(async (data, context) => {
  if (!context.auth) {
    throw new functions.https.HttpsError('unauthenticated', 'Login required.');
  }

  const { razorpay_payment_id, razorpay_subscription_id, razorpay_signature } = data;

  const expectedSig = crypto
    .createHmac('sha256', functions.config().razorpay.key_secret)
    .update(`${razorpay_payment_id}|${razorpay_subscription_id}`)
    .digest('hex');

  if (expectedSig !== razorpay_signature) {
    throw new functions.https.HttpsError('invalid-argument', 'Payment verification failed.');
  }

  const validUntil = new Date();
  validUntil.setMonth(validUntil.getMonth() + 1);

  await admin.firestore().doc(`eco_users/${context.auth.uid}`).set({
    subscription: {
      status:         'active',
      subscriptionId: razorpay_subscription_id,
      paymentId:      razorpay_payment_id,
      validUntil:     validUntil.toISOString(),
    },
  }, { merge: true });

  return { success: true };
});

// ── razorpayWebhook ───────────────────────────────────────────────────────────
// Razorpay calls this URL on subscription events (charged, cancelled, expired).
// Set the webhook URL in the Razorpay dashboard to:
//   https://<region>-<project>.cloudfunctions.net/razorpayWebhook
exports.razorpayWebhook = functions.https.onRequest(async (req, res) => {
  const secret    = functions.config().razorpay.webhook_secret;
  const signature = req.headers['x-razorpay-signature'];

  const expectedSig = crypto
    .createHmac('sha256', secret)
    .update(JSON.stringify(req.body))
    .digest('hex');

  if (expectedSig !== signature) {
    res.status(400).send('Invalid signature');
    return;
  }

  const event   = req.body.event;
  const subId   = req.body.payload?.subscription?.entity?.id;
  if (!subId) { res.status(200).send('OK'); return; }

  const usersRef = admin.firestore().collection('eco_users');
  const snap     = await usersRef.where('subscription.subscriptionId', '==', subId).get();
  if (snap.empty) { res.status(200).send('OK'); return; }

  const userDoc = snap.docs[0].ref;

  if (event === 'subscription.charged') {
    const validUntil = new Date();
    validUntil.setMonth(validUntil.getMonth() + 1);
    await userDoc.set({ subscription: { status: 'active', validUntil: validUntil.toISOString() } }, { merge: true });
  }

  if (event === 'subscription.cancelled' || event === 'subscription.expired') {
    await userDoc.set({ subscription: { status: 'cancelled' } }, { merge: true });
  }

  res.status(200).send('OK');
});
