import express from "express";
import cors from "cors";
import { MongoClient, ObjectId } from "mongodb";
import "dotenv/config";
import Stripe from "stripe";
import jwt from "jsonwebtoken";

const app = express();
const port = 5000;

const client = new MongoClient(
  `mongodb://${process.env.MONGO_USERNAME}:${process.env.MONGO_PASSWORD}@ac-tu4msos-shard-00-00.xujbby0.mongodb.net:27017,ac-tu4msos-shard-00-01.xujbby0.mongodb.net:27017,ac-tu4msos-shard-00-02.xujbby0.mongodb.net:27017/?ssl=true&replicaSet=atlas-113gae-shard-0&authSource=admin`,
);
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

export async function connectToMongoDB() {
  try {
    await client.connect();
    console.log("You successfully connected to MongoDB!");
    return client;
  } catch (err) {
    console.dir(err);
  }
}

const mongodb = await connectToMongoDB();
const database = mongodb.db("mentor-lagbe");
const tuitionsCollection = database.collection("tuitions");
const applicationCollection = database.collection("applications");
const usersCollection = database.collection("user");
const paymentsCollection = database.collection("payments");

app.use(cors());
app.use(express.json());

app.get("/", (req, res) => {
  res.send("Hello World!");
});

// Escapes special regex characters so user input like "(" or "*" can't break the query
const escapeRegex = (str) => str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// ---------------- JWT & ROLE MIDDLEWARES ----------------

// Issue signed JWT after BetterAuth login/session
app.post("/jwt", async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) {
      return res.status(400).json({ message: "Email is required" });
    }

    const user = await usersCollection.findOne({ email });
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    const token = jwt.sign(
      {
        email: user.email,
        role: user.role || "student",
      },
      process.env.JWT_ACCESS_SECRET,
      { expiresIn: "7d" },
    );

    res.json({ token });
  } catch (err) {
    console.error("JWT generation error:", err);
    res.status(500).json({ message: "Failed to generate token" });
  }
});

// Verify JWT token
const verifyToken = (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.status(401).json({ message: "Unauthorized: Missing token" });
  }

  const token = authHeader.split(" ")[1];
  jwt.verify(token, process.env.JWT_ACCESS_SECRET, (err, decoded) => {
    if (err) {
      return res
        .status(401)
        .json({ message: "Unauthorized: Invalid or expired token" });
    }
    req.decoded = decoded;
    next();
  });
};

// Verify Student role
const verifyStudent = async (req, res, next) => {
  const user = await usersCollection.findOne({ email: req.decoded?.email });
  if (user?.role !== "student") {
    return res.status(403).json({ message: "Forbidden: Student access only" });
  }
  next();
};

// Verify Tutor role
const verifyTutor = async (req, res, next) => {
  const user = await usersCollection.findOne({ email: req.decoded?.email });
  if (user?.role !== "tutor") {
    return res.status(403).json({ message: "Forbidden: Tutor access only" });
  }
  next();
};

// Verify Admin role
const verifyAdmin = async (req, res, next) => {
  const user = await usersCollection.findOne({ email: req.decoded?.email });
  if (user?.role !== "admin") {
    return res.status(403).json({ message: "Forbidden: Admin access only" });
  }
  next();
};

// ---------------- PUBLIC TUITION APIs ----------------

app.get("/tuitions", async (req, res) => {
  try {
    const {
      search,
      mode,
      subject,
      class: classLevel,
      location,
      page = 1,
      limit = 9,
    } = req.query;
    const filter = {
      approvalStatus: "approved",
      isActive: { $ne: false },
    };

    if (mode && mode !== "ALL") filter.mode = mode;
    if (subject && subject !== "ALL") filter.subject = subject;
    if (classLevel && classLevel !== "ALL") filter.classLevel = classLevel;
    if (location && location !== "ALL") {
      filter.location = new RegExp(escapeRegex(location.trim()), "i");
    }

    if (search && search.trim()) {
      const regex = new RegExp(escapeRegex(search.trim()), "i");
      filter.$or = [
        { title: regex },
        { subject: regex },
        { location: regex },
        { tutorName: regex },
      ];
    }

    const pageNum = Math.max(parseInt(page) || 1, 1);
    const limitNum = Math.min(parseInt(limit) || 9, 50);
    const skip = (pageNum - 1) * limitNum;

    const [tuitions, total] = await Promise.all([
      tuitionsCollection
        .find(filter)
        .sort({ _id: -1 })
        .skip(skip)
        .limit(limitNum)
        .toArray(),
      tuitionsCollection.countDocuments(filter),
    ]);

    res.json({
      data: tuitions,
      total,
      page: pageNum,
      totalPages: Math.ceil(total / limitNum),
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server error" });
  }
});

// IMPORTANT: Keep "/tuitions/subjects" above "/tuitions/:id"
app.get("/tuitions/subjects", async (req, res) => {
  try {
    const subjects = await tuitionsCollection.distinct("subject");
    res.json(subjects.filter(Boolean).sort());
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server error" });
  }
});

app.get("/tuitions/:id", async (req, res) => {
  try {
    const { id } = req.params;

    if (!ObjectId.isValid(id)) {
      return res.status(400).json({ message: "Invalid id" });
    }

    const result = await tuitionsCollection.findOne({ _id: new ObjectId(id) });

    if (!result) {
      return res.status(404).json({ message: "Tuition not found" });
    }

    res.send(result);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server error" });
  }
});

// ---------------- STUDENT APIs (JWT + Student Protected) ----------------

app.get(
  "/applications/:email",
  verifyToken,
  verifyStudent,
  async (req, res) => {
    const email = req.params.email;
    const result = await applicationCollection
      .find({ studentEmail: email })
      .toArray();
    res.send(result);
  },
);

app.post("/applications", verifyToken, verifyStudent, async (req, res) => {
  const data = req.body;

  // Prevent duplicate applications for the same tuition by the same student
  if (data?.tuitionId && data?.studentEmail) {
    const existing = await applicationCollection.findOne({
      tuitionId: data.tuitionId,
      studentEmail: data.studentEmail,
    });
    if (existing) {
      return res
        .status(409)
        .json({ message: "You have already applied to this tuition." });
    }
  }

  const result = await applicationCollection.insertOne({
    ...data,
    status: data.status || "pending",
    appliedAt: data.appliedAt || new Date().toISOString(),
  });
  res.send(result);
});

app.delete(
  "/applications/:id",
  verifyToken,
  verifyStudent,
  async (req, res) => {
    const id = req.params.id;
    const result = await applicationCollection.deleteOne({
      _id: new ObjectId(id),
    });
    res.send(result);
  },
);

app.patch(
  "/users/bookmarks/toggle",
  verifyToken,
  verifyStudent,
  async (req, res) => {
    try {
      const { email, tuitionId } = req.body;
      if (!email || !tuitionId) {
        return res.status(400).json({ message: "Missing email or tuitionId" });
      }

      const user = await usersCollection.findOne({ email });
      const current = Array.isArray(user?.bookmarkedTuitionIds)
        ? user.bookmarkedTuitionIds
        : [];
      const exists = current.includes(tuitionId);
      const isPro = String(user?.plan || "free").toLowerCase() === "pro";

      if (!exists && !isPro && current.length >= 5) {
        return res.status(403).json({
          message:
            "Free students can bookmark up to 5 tuitions. Upgrade to Pro for unlimited bookmarks.",
        });
      }

      const updated = exists
        ? current.filter((id) => id !== tuitionId)
        : [...current, tuitionId];

      await usersCollection.updateOne(
        { email },
        { $set: { bookmarkedTuitionIds: updated } },
        { upsert: true },
      );

      res.json({
        bookmarked: !exists,
        bookmarkedTuitionIds: updated,
      });
    } catch (err) {
      console.error("Bookmark toggle error:", err);
      res.status(500).json({ message: "Failed to toggle bookmark" });
    }
  },
);

app.get(
  "/users/bookmarks/:email",
  verifyToken,
  verifyStudent,
  async (req, res) => {
    try {
      const email = decodeURIComponent(req.params.email);
      const user = await usersCollection.findOne({ email });
      const ids = Array.isArray(user?.bookmarkedTuitionIds)
        ? user.bookmarkedTuitionIds
        : [];

      if (ids.length === 0) {
        return res.json([]);
      }

      const objectIds = ids
        .filter((id) => ObjectId.isValid(id))
        .map((id) => new ObjectId(id));

      const savedTuitions = await tuitionsCollection
        .find({ _id: { $in: objectIds } })
        .toArray();

      res.json(savedTuitions);
    } catch (err) {
      console.error("Fetch bookmarks error:", err);
      res.status(500).json({ message: "Failed to fetch saved tuitions" });
    }
  },
);

// ---------------- TUTOR APIs (JWT + Tutor Protected) ----------------

app.get(
  "/tuitions/tutor/:email",
  verifyToken,
  verifyTutor,
  async (req, res) => {
    const email = req.params.email;
    const tuitions = await tuitionsCollection
      .find({ tutorEmail: email })
      .sort({ createdAt: -1, _id: -1 })
      .toArray();
    res.json(tuitions);
  },
);

app.post("/tuitions", verifyToken, verifyTutor, async (req, res) => {
  const body = req.body;
  const tutor = await usersCollection.findOne({ email: body.tutorEmail });
  const plan = (tutor?.plan || "free").toLowerCase();

  if (plan !== "pro") {
    const existingCount = await tuitionsCollection.countDocuments({
      tutorEmail: body.tutorEmail,
    });
    if (existingCount >= 2) {
      return res.status(403).json({
        message:
          "Free plan allows up to 2 tuition posts. Upgrade to Pro for unlimited posts.",
      });
    }
  }

  const newTuition = {
    ...body,
    monthlyFee: Number(body.monthlyFee),
    daysPerWeek: Number(body.daysPerWeek),
    approvalStatus: "pending",
    isActive: true,
    createdAt: new Date().toISOString(),
  };

  const result = await tuitionsCollection.insertOne(newTuition);
  res.status(201).json({ ...newTuition, _id: result.insertedId });
});

app.patch("/tuitions/:id", verifyToken, verifyTutor, async (req, res) => {
  const { id } = req.params;
  const updates = req.body;
  const result = await tuitionsCollection.updateOne(
    { _id: new ObjectId(id) },
    { $set: updates },
  );
  res.json(result);
});

app.delete("/tuitions/:id", verifyToken, verifyTutor, async (req, res) => {
  const { id } = req.params;
  const result = await tuitionsCollection.deleteOne({ _id: new ObjectId(id) });
  res.json(result);
});

app.get(
  "/applications/tutor/:email",
  verifyToken,
  verifyTutor,
  async (req, res) => {
    const email = req.params.email;
    const applications = await applicationCollection
      .find({ tutorEmail: email })
      .sort({ appliedAt: -1, _id: -1 })
      .toArray();
    res.json(applications);
  },
);

app.patch(
  "/applications/:id/status",
  verifyToken,
  verifyTutor,
  async (req, res) => {
    const { id } = req.params;
    const { status } = req.body;
    if (!["accepted", "rejected", "pending"].includes(status)) {
      return res.status(400).json({ message: "Invalid status" });
    }
    const result = await applicationCollection.updateOne(
      { _id: new ObjectId(id) },
      { $set: { status } },
    );
    res.json(result);
  },
);

// ---------------- ADMIN APIs (JWT + Admin Protected) ----------------

app.get("/admin/overview", verifyToken, verifyAdmin, async (req, res) => {
  const users = await usersCollection.find().toArray();
  const tuitions = await tuitionsCollection.find().toArray();
  const payments = await paymentsCollection.find().toArray();

  const totalUsers = users.length;
  const totalTutors = users.filter((u) => u.role === "tutor").length;
  const pendingTuitions = tuitions.filter(
    (t) => t.approvalStatus === "pending",
  ).length;
  const approvedTuitions = tuitions.filter(
    (t) => t.approvalStatus === "approved",
  ).length;
  const totalRevenue = payments.reduce(
    (sum, p) => sum + Number(p.amount || 0),
    0,
  );

  res.json({
    totalUsers,
    totalTutors,
    pendingTuitions,
    approvedTuitions,
    totalRevenue,
  });
});

app.get("/admin/users", verifyToken, verifyAdmin, async (req, res) => {
  const users = await usersCollection.find().sort({ _id: -1 }).toArray();
  res.json(users);
});

app.patch(
  "/admin/users/:id/role",
  verifyToken,
  verifyAdmin,
  async (req, res) => {
    const { id } = req.params;
    const { role } = req.body;
    if (!["student", "tutor", "admin"].includes(role)) {
      return res.status(400).json({ message: "Invalid role" });
    }
    const result = await usersCollection.updateOne(
      { _id: new ObjectId(id) },
      { $set: { role } },
    );
    res.json(result);
  },
);

app.get("/admin/tuitions", verifyToken, verifyAdmin, async (req, res) => {
  const tuitions = await tuitionsCollection
    .find()
    .sort({ createdAt: -1, _id: -1 })
    .toArray();
  res.json(tuitions);
});

app.patch(
  "/admin/tuitions/:id/approval",
  verifyToken,
  verifyAdmin,
  async (req, res) => {
    const { id } = req.params;
    const { approvalStatus } = req.body;
    if (!["pending", "approved", "rejected"].includes(approvalStatus)) {
      return res.status(400).json({ message: "Invalid approval status" });
    }
    const result = await tuitionsCollection.updateOne(
      { _id: new ObjectId(id) },
      { $set: { approvalStatus } },
    );
    res.json(result);
  },
);

app.get("/admin/transactions", verifyToken, verifyAdmin, async (req, res) => {
  const payments = await paymentsCollection
    .find()
    .sort({ paidAt: -1, _id: -1 })
    .toArray();
  res.json(payments);
});

// ---------------- PAYMENTS & SHARED PROFILE APIs ----------------

app.post("/payments/create-checkout-session", verifyToken, async (req, res) => {
  try {
    const { userEmail, userName, userRole, planTier } = req.body;
    const normalizedRole = String(userRole || "student").toLowerCase();

    const amountUsd =
      planTier === "tutor_pro" || normalizedRole === "tutor" ? 15 : 10;
    const planName =
      normalizedRole === "tutor" ? "Tutor Pro Plan" : "Student Pro Plan";

    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      customer_email: userEmail,
      line_items: [
        {
          price_data: {
            currency: "usd",
            product_data: {
              name: planName,
              description:
                normalizedRole === "tutor"
                  ? "Unlimited tuition posts & Pro tutor badge on MentorLagbe"
                  : "Priority booking & Pro student benefits on MentorLagbe",
            },
            unit_amount: amountUsd * 100,
          },
          quantity: 1,
        },
      ],
      metadata: {
        userEmail,
        userName: userName || "",
        userRole: normalizedRole,
        planName,
        amount: String(amountUsd),
      },
      success_url: `${process.env.CLIENT_URL}/payment/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${process.env.CLIENT_URL}/payment/cancel`,
    });

    res.json({ url: session.url, id: session.id });
  } catch (err) {
    console.error("Stripe checkout error:", err);
    res.status(500).json({ message: "Failed to create checkout session" });
  }
});

app.post("/payments/verify-session", async (req, res) => {
  try {
    const { sessionId } = req.body;
    if (!sessionId) {
      return res.status(400).json({ message: "Missing sessionId" });
    }

    const checkoutSession = await stripe.checkout.sessions.retrieve(sessionId);

    if (checkoutSession.payment_status !== "paid") {
      return res.status(400).json({ message: "Payment not completed" });
    }

    const transactionId =
      typeof checkoutSession.payment_intent === "string"
        ? checkoutSession.payment_intent
        : checkoutSession.id;

    const existing = await paymentsCollection.findOne({
      stripeSessionId: checkoutSession.id,
    });

    const meta = checkoutSession.metadata || {};
    const userEmail = meta.userEmail || checkoutSession.customer_email || "";
    const amount = Number(
      meta.amount || (checkoutSession.amount_total || 0) / 100,
    );

    if (!existing) {
      await paymentsCollection.insertOne({
        userEmail,
        userName: meta.userName || "",
        userRole: meta.userRole || "student",
        planName: meta.planName || "Pro Plan",
        amount,
        currency: checkoutSession.currency || "usd",
        transactionId,
        stripeSessionId: checkoutSession.id,
        paymentStatus: "paid",
        paidAt: new Date().toISOString(),
      });
    }

    if (userEmail && usersCollection) {
      await usersCollection.updateOne(
        { email: userEmail },
        { $set: { plan: "pro" } },
      );
    }

    res.json({
      success: true,
      transactionId,
      plan: "pro",
    });
  } catch (err) {
    console.error("Verify session error:", err);
    res.status(500).json({ message: "Failed to verify payment" });
  }
});

app.get("/users/profile/:email", verifyToken, async (req, res) => {
  try {
    const email = decodeURIComponent(req.params.email);
    const user = await usersCollection.findOne({ email });
    res.json({
      name: user?.name || "",
      email,
      role: user?.role || "student",
      plan: user?.plan || "free",
      image: user?.image || "",
      phone: user?.phone || "",
      bio: user?.bio || "",
      bookmarkedTuitionIds: Array.isArray(user?.bookmarkedTuitionIds)
        ? user.bookmarkedTuitionIds
        : [],
    });
  } catch (err) {
    console.error("Fetch profile error:", err);
    res.status(500).json({ message: "Failed to fetch user profile" });
  }
});

app.patch("/users/profile/:email", verifyToken, async (req, res) => {
  try {
    const email = decodeURIComponent(req.params.email);
    const { name, phone, bio, image } = req.body;

    if (!name || !String(name).trim()) {
      return res.status(400).json({ message: "Name is required" });
    }

    const updateFields = {
      name: String(name).trim(),
      phone: String(phone || "").trim(),
      bio: String(bio || "").trim(),
    };

    if (image !== undefined) {
      updateFields.image = String(image || "").trim();
    }

    await usersCollection.updateOne(
      { email },
      { $set: updateFields },
      { upsert: true },
    );

    const updatedUser = await usersCollection.findOne({ email });
    res.json({
      success: true,
      user: {
        name: updatedUser?.name || updateFields.name,
        email,
        role: updatedUser?.role || "student",
        plan: updatedUser?.plan || "free",
        image: updatedUser?.image || "",
        phone: updatedUser?.phone || "",
        bio: updatedUser?.bio || "",
      },
    });
  } catch (err) {
    console.error("Update profile error:", err);
    res.status(500).json({ message: "Failed to update profile" });
  }
});

app.listen(port, () => {
  console.log(`Example app listening on port ${port}`);
});
