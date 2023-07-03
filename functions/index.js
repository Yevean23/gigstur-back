const functions = require("firebase-functions");
const admin = require("firebase-admin");

const YOUR_STRIPE_SECRET_KEY = process.env.STRIPE_API_KEY
  ? process.env.STRIPE_API_KEY
  : process.env.STRIPE_API_KEY; // TODO: replace with cloud run deployment variable
const stripe = require("stripe")(YOUR_STRIPE_SECRET_KEY);

admin.initializeApp();
require("dotenv").config();




exports.sendMoney = functions.https.onRequest(async (req, res) => {
  const { senderId, receiverId, amount } = req.body;

  try {
    // Retrieve sender and receiver data from Firestore
    const senderSnapshot = await admin
      .firestore()
      .doc(`users/${senderId}`)
      .get();
    const receiverSnapshot = await admin
      .firestore()
      .doc(`users/${receiverId}`)
      .get();

    if (!senderSnapshot.exists || !receiverSnapshot.exists) {
      res.status(404).send("User not found.");
      return;
    }

    const sender = senderSnapshot.data();
    const receiver = receiverSnapshot.data();

    // Retrieve sender's and receiver's Stripe customer IDs
    const senderCustomerId = sender.stripeCustomerId;
    const receiverCustomerId = receiver.stripeCustomerId;

    if (!senderCustomerId || !receiverCustomerId) {
      res
        .status(400)
        .send("Stripe customer ID not found for sender or receiver.");
      return;
    }

    // Charge the sender's Stripe account and transfer money to the receiver
    const transfer = await stripe.transfers.create({
      amount: amount * 100, // Convert to cents
      currency: "usd",
      source_transaction: senderCustomerId,
      destination: receiverCustomerId,
    });

    // Update sender's and receiver's balances in Firestore
    const senderBalance = sender.balance - amount;
    await admin
      .firestore()
      .doc(`users/${senderId}`)
      .update({ balance: senderBalance });

    const receiverBalance = receiver.balance + amount;
    await admin
      .firestore()
      .doc(`users/${receiverId}`)
      .update({ balance: receiverBalance });

    res.status(200).send("Money transferred successfully.");
  } catch (error) {
    console.error("Error transferring money:", error);
    res.status(500).send("An error occurred.");
  }
});

exports.createStripeCustomer = functions.auth.user().onCreate(async (user) => {
  const { uid, email } = user;

  try {
    // Create a Stripe customer
    const customer = await stripe.customers.create({
      email: email,
    });

    // Associate Stripe customer ID with the Firebase user
    await admin.firestore().collection("users").doc(uid).update({
      stripeCustomerId: customer.id,
    });

    console.log(`Stripe customer created: ${customer.id}`);
  } catch (error) {
    console.error("Error creating Stripe customer:", error);
  }
});

exports.stripeWebhook = functions.https.onRequest((req, res) => {
  const { data } = req.body;

  // Verify the webhook event using the Stripe secret key
  const stripeSignature = req.headers["stripe-signature"];
  const webhookSecret = "YOUR_STRIPE_SECRET_KEY"; // Replace with your actual webhook secret

  try {
    const event = stripe.webhooks.constructEvent(
      data,
      stripeSignature,
      webhookSecret
    );

    if (event.type === "customer.created") {
      const customerId = event.data.object.id;
      const userEmail = event.data.object.email;

      // Update Firebase user with the Stripe customer ID
      admin
        .auth()
        .getUserByEmail(userEmail)
        .then((userRecord) => {
          const userId = userRecord.uid;

          return admin.firestore().collection("users").doc(userId).update({
            stripeCustomerId: customerId,
          });
        })
        .then(() => {
          console.log(
            "Firebase user updated with Stripe customer ID:",
            customerId
          );
          res.status(200).send("Webhook handled successfully.");
        })
        .catch((error) => {
          console.error(
            "Error updating Firebase user with Stripe customer ID:",
            error
          );
          res.status(500).send("An error occurred.");
        });
    } else {
      res.status(200).send("Webhook event ignored.");
    }
  } catch (error) {
    console.error("Error verifying webhook event:", error);
    res.status(400).send("Invalid webhook event.");
  }
});

exports.testEndpoint = functions.https.onRequest((req, res) => {
    console.log(req);
    res.status(200).send("hello world");
  });