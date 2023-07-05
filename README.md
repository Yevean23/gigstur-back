# Gigstur Backend
A Firebase project

# Starting the Project

Starting this kind of project requires first setting up some stuff in the Firebase Console.
Start a project, upgrade it to the Blaze plan, set the budget to $0, and add a Firestore database.

Now it's time to set-up a repository on github to host the code, and clone it into your working directory.

# Dependencies

If you are cloning the repo, you will have to ```npm install``` before working with it.

Alternatively, if you want to set everything up yourself, then run the following code to get started.

```
npm init
install -g firebase-tools
firebase login
firebase init
cd functions
npm install firebase-admin firebase-functions express stripe dotenv
```

Note, the depedencies have to be intstalled into the ```package.json``` of the ```./functions``` folder.

Now it's time to run ```code .``` and start writing some APIs!

Modify ```./functions/index.js``` as the interface with google cloud functions.

You can create and import custom packages to ```index.js```, but the imports should also only act as interfaces.

# Development

## API Lifecycle

Requests will update a value in the *transactions* collection in the firestore database.

Then, a listener will pick up on the change and perform logic such as Stripe transfers in the background.

The stripe webhook will then update the value in *transactions* to be *complete*

Finally the front-end will respond to that.

## Project Structure

On an architectural level, the API code can do two things:

1. react to classic RESTful http requests. This is the typical api endpoints you'd expect an app to have.

```exports.endpointName = onRequest(async (req, res) => {});```

```exports.stripeWebhook = functions.https.onRequest((req, res) => {});```

This allows us to have an effective middleware layer with some google protections such as authentication.
This layer CRUDs documents in the firestore database.

Note: the stripe webhook is simply an endpoint that we create and tell Stripe to ping us at.
It contains all the information needed to update firestore.

2. react to changes in the firestore database.

```exports.reactToNewUserCreated = functions.auth.user().onCreate(async (user) => {});```

```exports.reactToDocumentCreated = onDocumentCreated("/messages/{documentId}", (event) => {});```

This layer should actually perform all the business logic, such as:
* reaching out to Stripe and other APIs
* performing time and ops intensive work
* asynchronous transactions

# Deployment

```
firebase deploy --only functions
```

# Operations

If you try to ping your endpoint from your browser, you may run into a 403 error.

This is because the endpoint is not configured to be accesible to unauthenticated public users.

This requires navigating to the Google Cloud Console and adding ```allUsers``` to the ```functionInvoker``` permissions in the function's options.
