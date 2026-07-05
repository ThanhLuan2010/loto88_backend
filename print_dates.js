const mongoose = require('mongoose');

const MONGODB_URI = "mongodb+srv://luannt:luannt@cluster0.99mpi.mongodb.net/";

const run = async () => {
  await mongoose.connect(MONGODB_URI);
  
  const LotteryResultSchema = new mongoose.Schema({
    date: String,
    region: String
  });
  const LotteryResult = mongoose.model('LotteryResult', LotteryResultSchema);

  const list = await LotteryResult.find().limit(20);
  console.log("Documents in lotteryresults:");
  list.forEach(r => {
    console.log(`- Date: ${r.date}, Region: ${r.region}`);
  });

  mongoose.disconnect();
};

run().catch(err => {
  console.error(err);
  mongoose.disconnect();
});
