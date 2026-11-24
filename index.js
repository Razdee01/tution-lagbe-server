import express from "express";
import cors from "cors";
import { MongoClient, ObjectId } from "mongodb";
import "dotenv/config";
import Stripe from "stripe";
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
const usersCollection=database.collection("user")
const paymentsCollection = database.collection("payments");
app.use(cors());
app.use(express.json());

app.get("/", (req, res) => {
  res.send("Hello World!");
});

// Escapes special regex characters so user input like "(" or "*" can't break the query
const escapeRegex = (str) => str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// ---------------- GET APIs ----------------

// Browse tuitions with search, filters and pagination
// Example: GET /tuitions?search=math&mode=ONLINE&subject=Physics&page=1&limit=9
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

    // 1. Exact-match filters
    if (mode && mode !== "ALL") filter.mode = mode;
    if (subject && subject !== "ALL") filter.subject = subject;
    if (classLevel && classLevel !== "ALL") filter.classLevel = classLevel;
    if (location && location !== "ALL") {
      filter.location = new RegExp(escapeRegex(location.trim()), "i");
    }

    // 2. Text search across several fields
    if (search && search.trim()) {
      const regex = new RegExp(escapeRegex(search.trim()), "i"); // i = case-insensitive
      filter.$or = [
        { title: regex },
        { subject: regex },
        { location: regex },
        { tutorName: regex },
      ];
    }

    // 3. Pagination
    const pageNum = Math.max(parseInt(page) || 1, 1);
    const limitNum = Math.min(parseInt(limit) || 9, 50); // cap it
    const skip = (pageNum - 1) * limitNum;

    const [tuitions, total] = await Promise.all([
      tuitionsCollection
        .find(filter)
        .sort({ _id: -1 }) // newest first
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

// Subject dropdown options.
// IMPORTANT: this must stay ABOVE "/tuitions/:id", otherwise "subjects" is treated as an id.
app.get("/tuitions/subjects", async (req, res) => {
  try {
    const subjects = await tuitionsCollection.distinct("subject");
    res.json(subjects.filter(Boolean).sort());
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server error" });
  }
});

// Single tuition by id
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
app.get("/applications/:email", async (req, res) => {
  const email = req.params.email;
  const result = await applicationCollection
    .find({ studentEmail: email })
    .toArray();

  res.send(result);
});

// ---------------- POST APIs ----------------

// student applies to a tuition
app.post("/applications", async (req, res) => {
  const data = req.body;
  const result = await applicationCollection.insertOne(data);
  res.send(result);
});

// ---------------- DELETE APIs ----------------
app.delete("/applications/:id",async(req,res)=>{
  const id=req.params.id
  const result =await applicationCollection.deleteOne({ _id: new ObjectId(id) });
  res.send(result)
});

// 1. Get all tuitions created by a tutor
app.get("/tuitions/tutor/:email", async (req, res) => {
  const email = req.params.email;
  const tuitions = await tuitionsCollection
    .find({ tutorEmail: email })
    .sort({ createdAt: -1, _id: -1 })
    .toArray();
  res.json(tuitions);
});

// 2. Post a new tuition (Free plan: max 2 posts; Pro plan: unlimited)
app.post("/tuitions", async (req, res) => {
  const body = req.body;
  const tutor = await usersCollection.findOne({ email: body.tutorEmail });
  const plan = (tutor?.plan || "free").toLowerCase();

  if (plan !== "pro") {
    const existingCount = await tuitionsCollection.countDocuments({
      tutorEmail: body.tutorEmail,
    });
    if (existingCount >= 2) {
      return res.status(403).json({
        message: "Free plan allows up to 2 tuition posts. Upgrade to Pro for unlimited posts.",
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

// 3. Update tuition details or toggle isActive
app.patch("/tuitions/:id", async (req, res) => {
  const { id } = req.params;
  const updates = req.body;
  const result = await tuitionsCollection.updateOne(
    { _id: new ObjectId(id) },
    { $set: updates }
  );
  res.json(result);
});

// 4. Delete a tuition post
app.delete("/tuitions/:id", async (req, res) => {
  const { id } = req.params;
  const result = await tuitionsCollection.deleteOne({ _id: new ObjectId(id) });
  res.json(result);
});

// 5. Get all student applications for a tutor's tuitions
app.get("/applications/tutor/:email", async (req, res) => {
  const email = req.params.email;
  const applications = await applicationCollection
    .find({ tutorEmail: email })
    .sort({ appliedAt: -1, _id: -1 })
    .toArray();
  res.json(applications);
});

// 6. Accept or Reject an application
app.patch("/applications/:id/status", async (req, res) => {
  const { id } = req.params;
  const { status } = req.body;
  if (!["accepted", "rejected", "pending"].includes(status)) {
    return res.status(400).json({ message: "Invalid status" });
  }
  const result = await applicationCollection.updateOne(
    { _id: new ObjectId(id) },
    { $set: { status } }
  );
  res.json(result);
});

// admin
// Admin Overview stats
app.get("/admin/overview", async (req, res) => {
  const users = await usersCollection.find().toArray();
  const tuitions = await tuitionsCollection.find().toArray();
  const payments = await paymentsCollection.find().toArray();
  
  

  const totalUsers = users.length;
  
  const totalTutors = tuitions.length
  
  
  const pendingTuitions = tuitions.filter(
    (t) => t.approvalStatus === "pending"
  ).length;
  const approvedTuitions = tuitions.filter(
    (t) => t.approvalStatus === "approved"
  ).length;
  const totalRevenue = payments.reduce(
    (sum, p) => sum + Number(p.amount || 0),
    0
  );

  res.json({
    totalUsers,
    totalTutors,
    pendingTuitions,
    approvedTuitions,
    totalRevenue,
  });
});

// Get all users
app.get("/admin/users", async (req, res) => {
  const users = await usersCollection.find().sort({ _id: -1 }).toArray();
  res.json(users);
});

// Update user role
app.patch("/admin/users/:id/role", async (req, res) => {
  const { id } = req.params;
  const { role } = req.body;
  if (!["student", "tutor", "admin"].includes(role)) {
    return res.status(400).json({ message: "Invalid role" });
  }
  const result = await usersCollection.updateOne(
    { _id: new ObjectId(id) },
    { $set: { role } }
  );
  res.json(result);
});

// Get all tuitions for moderation
app.get("/admin/tuitions", async (req, res) => {
  const tuitions = await tuitionsCollection
    .find()
    .sort({ createdAt: -1, _id: -1 })
    .toArray();
  res.json(tuitions);
});

// Approve or Reject tuition
app.patch("/admin/tuitions/:id/approval", async (req, res) => {
  const { id } = req.params;
  const { approvalStatus } = req.body;
  if (!["pending", "approved", "rejected"].includes(approvalStatus)) {
    return res.status(400).json({ message: "Invalid approval status" });
  }
  const result = await tuitionsCollection.updateOne(
    { _id: new ObjectId(id) },
    { $set: { approvalStatus } }
  );
  res.json(result);
});

// Get all payment transactions
app.get("/admin/transactions", async (req, res) => {
  const payments = await paymentsCollection
    .find()
    .sort({ paidAt: -1, _id: -1 })
    .toArray();
  res.json(payments);
});
// 1. Create Stripe Checkout Session for Pro Plan ($15 Tutor / $10 Student)
app.post("/payments/create-checkout-session", async (req, res) => {
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

// 2. Verify session on /payment/success, save payment, and upgrade user plan to "pro"
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

    // Avoid duplicate records if the user refreshes /payment/success
    const existing = await paymentsCollection.findOne({
      stripeSessionId: checkoutSession.id,
    });

    const meta = checkoutSession.metadata || {};
    const userEmail = meta.userEmail || checkoutSession.customer_email || "";
    const amount = Number(
      meta.amount || (checkoutSession.amount_total || 0) / 100
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
        { $set: { plan: "pro" } }
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
app.get("/users/profile/:email", async (req, res) => {
  try {
    const email = decodeURIComponent(req.params.email);
    const user = await usersCollection.findOne({ email });
    res.json({
      name: user?.name || "",
      email,
      role: user?.role || "student",
      plan: user?.plan || "Free",
      image: user?.image || "",
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Failed to fetch user profile" });
  }
});
app.patch("/users/bookmarks/toggle", async (req, res) => {
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
});

app.get("/users/bookmarks/:email", async (req, res) => {
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
});
app.get("/users/profile/:email", async (req, res) => {
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

app.patch("/users/profile/:email", async (req, res) => {
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
