const express = require("express");
const cors = require("cors");
const { MongoClient, ObjectId } = require("mongodb");
const jwt = require("jsonwebtoken");
require("dotenv").config();
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

const app = express();
const port = process.env.PORT || 5000;

// Middleware
app.use(cors());
app.use(express.json());

// Middleware for JWT verification
const verifyJWT = (req, res, next) => {
  try {
    let token = req.headers.authorization;
    if (!token) {
      throw new Error("unauthorized user");
    }
    token = token.split(" ")[1];

    const decoded = jwt.verify(token, process.env.JWT_SECRET_KEY);
    if (!decoded) {
      throw new Error("unauthorized user");
    }
    req.decoded = decoded;
    next();
  } catch (error) {
    res.status(401).send({ error: error.message });
  }
};

// MongoDB connection setup
const uri = `mongodb+srv://${process.env.MONGO_USER}:${process.env.MONGO_PASS}@cluster0.bukpahx.mongodb.net/?retryWrites=true&w=majority`;
const client = new MongoClient(uri);

const run = async () => {
  try {
    // Collections setup
    const Users = client.db("LensCraft").collection("users");
    const Payments = client.db("LensCraft").collection("payments");

    // Middleware for verifying admin role
    const verifyAdmin = async (req, res, next) => {
      try {
        const email = req.decoded.email;
        const user = await Users.findOne({ email });
        if (user.role !== "admin") {
          return res.send({ isAdmin: false });
        }
        next();
      } catch (error) {
        res.status(500).send({ error: error.message });
      }
    };

    // Generate JWT web token
    app.post("/jwt", (req, res) => {
      const user = req.body;
      const token = jwt.sign(user, process.env.JWT_SECRET_KEY, {
        expiresIn: "2d",
      });
      res.send({ token: `Bearer ${token}` });
    });

    // Get all users
    app.get("/api/users", verifyJWT, verifyAdmin, async (req, res) => {
      try {
        const users = await Users.find().toArray();
        res.send(users);
      } catch (error) {
        res.status(500).send({ error: error.message });
      }
    });

    // Create a user
    app.post("/api/users", async (req, res) => {
      try {
        const existingUser = await Users.findOne({ email: req.body.email });
        if (existingUser) {
          res.send(existingUser);
          return;
        }
        const result = await Users.insertOne(req.body);
        res.send(result);
      } catch (error) {
        res.status(500).send({ error: error.message });
      }
    });

    // Make a user admin
    app.patch("/api/users/:id", async (req, res) => {
      try {
        const _id = new ObjectId(req.params.id);
        const result = await Users.updateOne(
          { _id },
          { $set: { role: "admin" } }
        );
        res.send(result);
      } catch (error) {
        res.status(500).send({ error: error.message });
      }
    });

    // Send isAdmin
    app.get(
      "/api/users/admin/:email",
      verifyJWT,
      verifyAdmin,
      async (req, res) => {
        res.send({ isAdmin: true });
      }
    );

    // Create payment
    app.post("/api/create-payment-intent", verifyJWT, async (req, res) => {
        try {
        const { price } = req.body;
        const amount = parseFloat((price * 100).toFixed(2));
      
        // Create a PaymentIntent with the order amount and currency
        const paymentIntent = await stripe.paymentIntents.create({
          amount,
          currency: "usd",
          payment_method_types: ["card"]
        });
      
        res.send({
          clientSecret: paymentIntent.client_secret,
        });
        } catch (error) {
            res.status(500).send({ error: error.message });
        }
      });

    // Save payment
    app.post("/api/save-payment-info", verifyJWT, async (req, res) => {
        try {
            const { cartIds, items, ...others } = req.body;
            const result = await Payments.insertOne({...others, items: items.map(i=>new ObjectId(i)), date: new Date()});
            const deleteResult = await CartItems.deleteMany({_id: {$in: cartIds.map(id=> new ObjectId(id))}});
            res.send({result, deleteResult});
        } catch (error) {
            res.status(500).send({ error: error.message });
        }
    });

  } catch (error) {
    console.log(error);
  }
};

run();

// Home route
app.get("/", (req, res) => {
  res.send("<h1>Welcome to LensCraft Server</h1>");
});

app.listen(port, () => {
  console.log(`Server is running on port ${port}`);
});
