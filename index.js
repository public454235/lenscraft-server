const express = require("express");
const cors = require("cors");
const { MongoClient, ObjectId } = require("mongodb");
const jwt = require("jsonwebtoken");
require("dotenv").config();
const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);

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
    await client.connect();
    console.log("MongoDB is connected");
    // Collections setup
    const Users = client.db("LensCraft").collection("users");
    const SliderContents = client.db("LensCraft").collection("sliderContents");
    const Classes = client.db("LensCraft").collection("classes");
    const SavedClasses = client.db("LensCraft").collection("savedClasses");
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

    // Middleware for verifying instructor role
    const verifyInstructor = async (req, res, next) => {
      try {
        const email = req.decoded.email;
        const user = await Users.findOne({ email });
        if (user.role !== "instructor") {
          return res.send({ isInstructor: false });
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
        const email = req.decoded.email;
        const users = await Users.find({email: {$not: {$eq: email}}}).toArray();
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

    // Make a user admin or instructor
    app.patch("/api/users/:id", verifyJWT, verifyAdmin, async (req, res) => {
      try {
        const _id = new ObjectId(req.params.id);
        const { role } = req.body;
        const result = await Users.updateOne({ _id }, { $set: { role } });
        res.send(result);
      } catch (error) {
        res.status(500).send({ error: error.message });
      }
    });

    // Send role status
    app.get("/api/users/:email", verifyJWT, async (req, res) => {
      try {
        const { email } = req.decoded;
        if (email !== req.params.email) {
          return res.status(403).send({ error: "bad auth" });
        }
        const user = await Users.findOne({ email });
        const role = user.role || "student";
        res.send({ role });
      } catch (error) {
        res.status(500).send({ error: error.message });
      }
    });

    // get slider contents
    app.get("/api/slider-contents", async (req, res) => {
      try {
        const sliderContents = await SliderContents.find().toArray();
        res.send(sliderContents);
      } catch (error) {
        res.status(500).send({ error: error.message });
      }
    });

    // get all classes
    app.get("/api/all-classes", verifyJWT, verifyAdmin, async (req, res) => {
      try {
        const classes = await Classes.find().toArray();
        res.send(classes);
      } catch (error) {
        res.status(500).send({ error: error.message });
      }
    })

    // get all classes by email
    app.get("/api/all-classes/:email", verifyJWT, verifyInstructor, async (req, res) => {
      try {
        const classes = await Classes.find({"instructor.email": req.params.email}).toArray();
        res.send(classes);
      } catch (error) {
        res.status(500).send({ error: error.message });
      }
    })

    // post classes
    app.post("/api/all-classes", verifyJWT, verifyInstructor, async (req, res) => {
      try {
        const {name, image, instructor, seats, price} = req.body;
        const result = await Classes.insertOne({name,image, instructor, seats, price, status: "pending", enrolledCount: 0});
        res.send(result);
      } catch (error) {
        res.status(500).send({ error: error.message });
      }
    })

    // get all approved classes
    app.get("/api/classes", async (req, res) => {
      try {
        const classes = await Classes.find({ status: "approved" }).toArray();
        res.send(classes);
      } catch (error) {
        res.status(500).send({ error: error.message });
      }
    });
    

    // approve or deny class by admin
    app.patch("/api/classes/:id", verifyJWT, verifyAdmin, async (req, res) => {
      try {
        const {action} = req.body;
        const result = await Classes.updateOne({_id: new ObjectId(req.params.id)}, {$set: {status: action}});
        res.send(result);
      } catch (error) {
        res.status(500).send({ error: error.message });
      }
    })

    // get popular classes
    app.get("/api/popular-classes", async (req, res) => {
      try {
        const classes = await Classes.find({ status: "approved" })
          .sort({ enrolledCount: -1 })
          .limit(6)
          .toArray();
        res.send(classes);
      } catch (error) {
        res.status(500).send({ error: error.message });
      }
    });

    // get all instructors
    app.get("/api/instructors", async (req, res) => {
      try {
        const instructors = await Users.find({ role: "instructor" }).toArray();
        res.send(instructors);
      } catch (error) {
        res.status(500).send({ error: error.message });
      }
    });

    // get popular instructors
    app.get("/api/popular-instructors", async (req, res) => {
      try {
        const instructors = await Users.find({ role: "instructor" })
          .limit(6)
          .toArray();
        res.send(instructors);
      } catch (error) {
        res.status(500).send({ error: error.message });
      }
    });

    // get selected classes by email
    app.get("/api/selected-classes/:email", verifyJWT, async (req, res) => {
      try {
        const pipeline = [
          {
            $match: {
              email: req.params.email,
            },
          },
          {
            $lookup: {
              from: "classes",
              localField: "classId",
              foreignField: "_id",
              as: "classDetails",
            },
          },
          {
            $unwind: "$classDetails",
          },
          {
            $addFields: {
              availableSeats: {
                $subtract: [
                  "$classDetails.seats",
                  "$classDetails.enrolledCount",
                ],
              },
            },
          },
          {
            $project: {
              classDetails: 0,
            },
          },
        ];

        const classes = await SavedClasses.aggregate(pipeline).toArray();
        res.send(classes);
      } catch (error) {
        res.status(500).send({ error: error.message });
      }
    });

    // post selected classes
    app.post("/api/selected-classes", verifyJWT, async (req, res) => {
      try {
        const { classId, name, image, price, instructor, email } = req.body;

        const existingAtCard = await SavedClasses.findOne({
          classId: new ObjectId(classId),
        });
        if (existingAtCard) {
          return res.send({ message: name + "is already added!" });
        }

        const existingAtPayments = await Payments.findOne({
          classId: new ObjectId(classId),
        });
        if (existingAtPayments) {
          return res.send({ message: name + " course is already purchased!" });
        }

        const result = await SavedClasses.insertOne({
          classId: new ObjectId(classId),
          name,
          image,
          price,
          instructor,
          email,
        });
        res.send(result);
      } catch (error) {
        res.status(500).send({ error: error.message });
      }
    });

    // delete a class from selected classes
    app.delete("/api/selected-classes/:id", verifyJWT, async (req, res) => {
      try {
        const result = await SavedClasses.deleteOne({
          _id: new ObjectId(req.params.id),
        });
        res.send(result);
      } catch (error) {
        res.status(500).send({ error: error.message });
      }
    });

    // get enrolled classes
    app.get("/api/enrolled-classes/:email", verifyJWT, async (req, res) => {
      try {
        const enrolledClasses = await Payments.aggregate([
          {
            $match: {
              email: req.params.email,
            },
          },
          {
            $lookup: {
              from: "classes",
              localField: "classId",
              foreignField: "_id",
              as: "classDetails",
            },
          },
          {
            $unwind: "$classDetails",
          },
        ]).sort({date: -1}).toArray();
        
        res.send(enrolledClasses);
      } catch (error) {
        res.status(500).send({ error: error.message });
      }
    });

    // Create payment
    app.post("/api/create-payment-intent", verifyJWT, async (req, res) => {
      try {
        const { price } = req.body;
        const amount = parseFloat((price * 100).toFixed(2));

        // Create a PaymentIntent with the order amount and currency
        const paymentIntent = await stripe.paymentIntents.create({
          amount,
          currency: "usd",
          payment_method_types: ["card"],
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
        const { _id, classId, email, paymentAmount, transactionId } = req.body;
        const result = await Payments.insertOne({
          email,
          classId: new ObjectId(classId),
          paymentAmount,
          transactionId,
          date: new Date(),
        });
        const deleteResult = await SavedClasses.deleteOne({
          _id: new ObjectId(_id),
        });
        const filter = { _id: new ObjectId(classId) };
        const existingResult = await Classes.findOne(filter);
        const updateResult = await Classes.updateOne(
          filter,
          { $set: { enrolledCount: existingResult.enrolledCount + 1 } },
          { upsert: true }
        );
        res.send({ result, deleteResult, updateResult });
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
