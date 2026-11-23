import express from "express";
import cors from "cors";
import { MongoClient, ObjectId } from "mongodb";
import "dotenv/config";

const app = express();
const port = 5000;

const client = new MongoClient(
  `mongodb://${process.env.MONGO_USERNAME}:${process.env.MONGO_PASSWORD}@ac-tu4msos-shard-00-00.xujbby0.mongodb.net:27017,ac-tu4msos-shard-00-01.xujbby0.mongodb.net:27017,ac-tu4msos-shard-00-02.xujbby0.mongodb.net:27017/?ssl=true&replicaSet=atlas-113gae-shard-0&authSource=admin`,
);

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
    const filter = {};

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
app.listen(port, () => {
  console.log(`Example app listening on port ${port}`);
});
