# gigstur-back
gig-stur backend

# Starting the Project

Starting this kind of project requires first setting up some stuff in the Firebase Console.
Start a project, upgrade it to the Blaze plan, set the budget to $0, and add a Firestore database.

Now it's time to set-up a repository on github to host the code, and clone it into your working directory.

# Install Dependencies

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

# Coding


# Deployment

```
firebase deploy --only functions
```

# Operations

If you try to ping your endpoint from your browser, you may run into an error.

This is because the endpoint is not configured to be accesible to unauthenticated users.

This requires navigating to the Google Cloud Console and adding ```allUsers``` to the ```functionInvoker``` permissions in the function's options.
