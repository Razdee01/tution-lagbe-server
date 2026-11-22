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
const mongodb =await connectToMongoDB()
  const database = mongodb.db("mentor-lagbe");
  const tuitionsCollection = database.collection("tuitions");
  const applicationCollection = database.collection("applications");

app.use(cors());
app.use(express.json());

app.get("/", (req, res) => {
  res.send("Hello World!");
});

app.listen(port, () => {
  console.log(`Example app listening on port ${port}`);
});
// get apis
app.get("/tuitions", async (req, res) => {
  const result = await tuitionsCollection.find().toArray();
  res.send(result);
});
app.get("/tuitions/:id",async(req,res)=>{
  const id = req.params
  const result= await tuitionsCollection.findOne({_id:new ObjectId(id)})
  res.send(result)
})
// post apis
app.post("/applications",async(req,res)=>{
  const data=req.body
  const result =await applicationCollection.insertOne(data)
  res.send(result)
});