const functions = require("firebase-functions");
const admin = require("firebase-admin");
admin.initializeApp();
const cors = require("cors")({ origin: true });
const stripe = require("stripe")(functions.config().stripe.api_key);

exports.createStripeCustomer = functions.auth.user().onCreate(async (user) => {
  const { uid, email } = user;

  try {
    // Create a Stripe customer
    const customer = await stripe.customers.create({
      email: email,
    });

    // Associate Stripe customer ID with the Firebase user
    await admin.firestore().collection("users").doc(uid).set(
      {
        stripeCustomerId: customer.id,
        balance: 0,
      },
      { merge: true }
    );

    console.log(`Stripe customer created: ${customer.id}`);
  } catch (error) {
    console.error("Error creating Stripe customer:", error);
  }
});

exports.addPaymentMethodToAccount = functions.https.onRequest((req, res) => {
  cors(req, res, () => {
    /*/ Ensure the request has necessary parameters
    if (!req.body.paymentMethodId || !req.body.accountId) {
      return res.status(400).json({ error: "Missing parameters" });
    }/*/
    const paymentMethodId = req.body.paymentMethodId;
    const userId = req.body.userId;

    // Retrieve the account from Firestore
    const accountRef = admin.firestore().collection("users").doc(userId);
    accountRef
      .get()
      .then((accountDoc) => {
        if (!accountDoc.exists) {
          return res.status(404).json({ error: "Account not found" });
        }

        // Create the payment method in Stripe
        stripe.paymentMethods
          .attach(paymentMethodId, {
            customer: accountDoc.data().stripeCustomerId,
          })
          .then(() => {
            // Update the account in Firestore with the new payment method
            accountRef.update({ paymentMethodId: paymentMethodId }).then(() => {
              return res
                .status(200)
                .json({ message: "Payment method added successfully" });
            });
          })
          .catch((error) => {
            console.error(error);
            return res
              .status(500)
              .json({ error: "Failed to add payment method" });
          });
      })
      .catch((error) => {
        console.error(error);
        return res.status(500).json({ error: "Failed to retrieve account" });
      });
  });
});

exports.savePaymentMethod = functions.https.onCall(async (data, context) => {
  // Check if the user is authenticated
  if (!context.auth) {
    throw new functions.https.HttpsError('unauthenticated', 'User must be authenticated.');
  }

  try {
    const { paymentMethodId, customerId, cardData } = data;

    // Save payment method to Stripe
    await stripe.paymentMethods.attach(paymentMethodId, { customer: customerId });

    // Save card data to Firebase
    const userId = context.auth.uid;
    await admin.firestore().collection('users').doc(userId).collection('cards').doc(paymentMethodId).set(cardData);

    return { message: 'Payment method saved successfully.' };
  } catch (error) {
    throw new functions.https.HttpsError('internal', 'An error occurred while saving the payment method.', error);
  }
});

exports.addMoneyToAccount = functions.https.onRequest(async (req, res) => {
  cors(req, res, async () => {
    try {
      // const { amount, userId } = req.body.data; // Assuming the amount and userId are provided in the request body
      const amount = req.body.data.amount;
      const userId = req.body.data.userId;
      console.log("body", req.body);
      console.log("query", req.query);
      console.log("userid", userId);
      console.log("amount", amount);
      // Retrieve the user's document from Firestore
      const userSnapshot = await admin
        .firestore()
        .collection("users")
        .doc(userId)
        .get();
      if (!userSnapshot.exists) {
        throw new Error("User not found.");
      }

      const { stripeCustomerId, balance } = userSnapshot.data();

      const paymentIntent = await stripe.paymentIntents.create({
        amount: amount, // The transaction amount in cents or smallest currency unit
        currency: "usd", // The currency code, adjust as needed
        customer: stripeCustomerId,
        // Add additional  options if needed
      });
      const new_bal = Number(balance) + Number(amount);
      // Update the user's balance in Firestore
      const userRef = admin.firestore().collection("users").doc(userId);
      await userRef.update({
        balance: new_bal,
      });

      res
        .status(200)
        .json({ success: true, message: "Money added successfully." });
    } catch (error) {
      console.error("Error adding money to account:", error);
      res
        .status(500)
        .json({ success: false, message: "Error adding money to account." });
    }
  });
});

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

exports.withdrawMoneyFromAccount = functions.https.onRequest(async (req, res) => {
  cors(req, res, async () => {
    try {
      const { amount, userId } = req.body;

      // Retrieve the user's document from Firestore
      const userSnapshot = await admin
        .firestore()
        .collection("users")
        .doc(userId)
        .get();

      if (!userSnapshot.exists) {
        throw new Error("User not found.");
      }

      const { stripeCustomerId, balance } = userSnapshot.data();

      // Create a charge in Stripe to withdraw the money
      const charge = await stripe.charges.create({
        amount: amount * 100, // Convert to cents
        currency: "usd",
        customer: stripeCustomerId,
        description: "Withdrawal from user's account",
      });

      // Calculate the new balance after withdrawal
      const newBalance = balance - amount;

      // Update the user's balance in Firestore
      const userRef = admin.firestore().collection("users").doc(userId);
      await userRef.update({
        balance: newBalance,
      });

      res
        .status(200)
        .json({ success: true, message: "Money withdrawn successfully." });
    } catch (error) {
      console.error("Error withdrawing money from account:", error);
      res
        .status(500)
        .json({ success: false, message: "Error withdrawing money from account." });
    }
  });
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


exports.createGig = functions.https.onRequest((req, res) => {
  cors(req, res, async () => {
    try {
      // Retrieve the necessary data from the request body
      const { title, description, price, userId } = req.body;

      // Create a new gig document in Firestore
      const gigData = {
        title: title,
        description: description,
        price: price,
        userId: userId,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
      };

      const gigRef = admin.firestore().collection("gigs");
      const newGig = await gigRef.add(gigData);

      res.status(200).json({ success: true, gigId: newGig.id });
    } catch (error) {
      console.error("Error creating gig:", error);
      res.status(500).json({ success: false, message: "Error creating gig." });
    }
  });
});

exports.getGig = functions.https.onRequest((req, res) => {
  cors(req, res, async () => {
    try {
      const gigId = req.query.gigId;

      // Retrieve the gig document from Firestore
      const gigSnapshot = await admin.firestore().collection("gigs").doc(gigId).get();

      if (!gigSnapshot.exists) {
        res.status(404).json({ success: false, message: "Gig not found." });
        return;
      }

      const gigData = gigSnapshot.data();

      res.status(200).json({ success: true, gig: gigData });
    } catch (error) {
      console.error("Error getting gig:", error);
      res.status(500).json({ success: false, message: "Error getting gig." });
    }
  });
});


exports.updateGig = functions.https.onRequest((req, res) => {
  cors(req, res, async () => {
    try {
      const { gigId, title, description, price } = req.body;

      // Update the gig document in Firestore
      const gigRef = admin.firestore().collection("gigs").doc(gigId);
      await gigRef.update({
        title: title,
        description: description,
        price: price,
      });

      res.status(200).json({ success: true, message: "Gig updated successfully." });
    } catch (error) {
      console.error("Error updating gig:", error);
      res.status(500).json({ success: false, message: "Error updating gig." });
    }
  });
});


exports.deleteGig = functions.https.onRequest((req, res) => {
  cors(req, res, async () => {
    try {
      const gigId = req.body.gigId;

      // Delete the gig document from Firestore
      await admin.firestore().collection("gigs").doc(gigId).delete();

      res.status(200).json({ success: true, message: "Gig deleted successfully." });
    } catch (error) {
      console.error("Error deleting gig:", error);
      res.status(500).json({ success: false, message: "Error deleting gig." });
    }
  });
});
