require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const TelegramBot = require('node-telegram-bot-api');

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 3000;
const TELEGRAM_TOKEN = process.env.TELEGRAM_BOT_TOKEN;

// Kiểm tra môi trường Vercel
const isVercel = process.env.VERCEL === '1' || process.env.VERCEL === 'true' || !!process.env.VERCEL;

// Khởi tạo Telegram Bot (chỉ bật polling khi không chạy trên Vercel)
const bot = new TelegramBot(TELEGRAM_TOKEN, { polling: !isVercel });

// Kết nối MongoDB
mongoose.connect(process.env.MONGODB_URI)
  .then(() => console.log("MongoDB Connected"))
  .catch(err => console.log("MongoDB Error:", err));

// Schema lưu Token Đăng Nhập
const LoginTokenSchema = new mongoose.Schema({
  token: String,
  telegramId: String,
  firstName: String,
  username: String,
  isVerified: { type: Boolean, default: false },
  loginAt: { type: Date, default: Date.now } // Không bao giờ xóa
});
const LoginToken = mongoose.model('LoginToken', LoginTokenSchema);

// Schema Khách hàng (User)
const UserSchema = new mongoose.Schema({
  telegramId: { type: String, unique: true },
  firstName: String,
  username: String,
  depositCurrentMonth: { type: Number, default: 0 },
  points: { type: Number, default: 0 },
  joinedAt: { type: Date, default: Date.now }
});
const User = mongoose.model('User', UserSchema);

// Schema Quà tặng (Gift)
const GiftSchema = new mongoose.Schema({
  name: String,
  points: Number,
  image: String,
  isActive: { type: Boolean, default: true },
  createdAt: { type: Date, default: Date.now }
});
const Gift = mongoose.model('Gift', GiftSchema);

// Schema Đơn đổi quà (Order)
const OrderSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  gift: { type: mongoose.Schema.Types.ObjectId, ref: 'Gift' },
  giftImage: String,
  status: { type: String, enum: ['PENDING', 'COMPLETED', 'CANCELLED'], default: 'PENDING' },
  createdAt: { type: Date, default: Date.now }
});
const Order = mongoose.model('Order', OrderSchema);

// Bot lắng nghe lệnh /start TOKEN_123
bot.onText(/\/start (.+)/, async (msg, match) => {
  const chatId = msg.chat.id;
  const token = match[1]; // Lấy token từ message

  try {
    // Tìm token trong DB
    const loginToken = await LoginToken.findOne({ token });
    
    if (loginToken) {
      if (loginToken.isVerified) {
        return bot.sendMessage(chatId, "Token này đã được sử dụng rồi.");
      }

      // Cập nhật thông tin khách hàng vào token
      loginToken.isVerified = true;
      loginToken.telegramId = msg.from.id.toString();
      loginToken.firstName = msg.from.first_name;
      loginToken.username = msg.from.username || '';
      await loginToken.save();

      // Lưu luôn vào DB User chính thức
      let user = await User.findOne({ telegramId: loginToken.telegramId });
      if (!user) {
        user = new User({
          telegramId: loginToken.telegramId,
          firstName: loginToken.firstName,
          username: loginToken.username,
        });
        await user.save();
      }

      bot.sendMessage(chatId, `Chào mừng ${msg.from.first_name}!\nBạn đã đăng nhập thành công vào ứng dụng Đổi Quà Loto. Vui lòng quay lại ứng dụng.`);
    } else {
      bot.sendMessage(chatId, "Mã đăng nhập không hợp lệ hoặc đã hết hạn.");
    }
  } catch (error) {
    console.error(error);
    bot.sendMessage(chatId, "Đã có lỗi xảy ra, vui lòng thử lại sau.");
  }
});

// API nhận webhook từ Telegram
app.post('/api/telegram-webhook', async (req, res) => {
  try {
    bot.processUpdate(req.body);
    res.sendStatus(200);
  } catch (error) {
    console.error("Webhook processing error:", error);
    res.sendStatus(500);
  }
});

// API hỗ trợ tự động thiết lập Webhook URL với Telegram
app.get('/api/telegram-setup', async (req, res) => {
  const host = req.headers.host;
  const protocol = req.headers['x-forwarded-proto'] || 'https';
  const url = `${protocol}://${host}/api/telegram-webhook`;
  try {
    await bot.setWebHook(url);
    res.json({ success: true, message: `Webhook has been set to: ${url}` });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// API cho Mobile App gọi để lấy Token mới
app.get('/api/auth/generate-token', async (req, res) => {
  // Tránh tình trạng treo App do MongoDB chưa kết nối
  if (mongoose.connection.readyState !== 1) {
    return res.status(500).json({ success: false, message: "Lỗi Backend: MongoDB chưa được kết nối." });
  }

  const token = "LOTO_" + Math.random().toString(36).substr(2, 9).toUpperCase();
  try {
    const newToken = new LoginToken({ token });
    await newToken.save();
    res.json({ success: true, token });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// API cho Mobile App polling kiểm tra xem Token đã được Bot xác nhận chưa
app.get('/api/auth/check-token', async (req, res) => {
  const { token } = req.query;
  try {
    const loginToken = await LoginToken.findOne({ token });
    if (!loginToken) {
      return res.json({ success: false, message: "Token không tồn tại hoặc đã hết hạn" });
    }

    if (loginToken.isVerified) {
      // Đăng nhập thành công, trả về thông tin user
      res.json({
        success: true,
        user: {
          telegramId: loginToken.telegramId,
          firstName: loginToken.firstName,
          username: loginToken.username
        }
      });
      // (Tuỳ chọn) Sau khi login xong có thể xoá luôn token
      // await LoginToken.deleteOne({ token });
    } else {
      res.json({ success: false, isPending: true });
    }
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// API: ĐỔI QUÀ (Mobile App gọi)
app.post('/api/orders', async (req, res) => {
  const { telegramId, giftId } = req.body;
  try {
    const user = await User.findOne({ telegramId });
    const gift = await Gift.findById(giftId);
    
    if (!user || !gift) return res.status(404).json({ success: false, message: "Không tìm thấy user hoặc quà." });
    
    if (user.points < gift.points) {
      return res.status(400).json({ success: false, message: "Không đủ điểm đổi quà." });
    }

    // Trừ điểm và tạo đơn
    user.points -= gift.points;
    await user.save();

    const order = new Order({ 
      user: user._id, 
      gift: gift._id,
      giftImage: gift.image
    });
    await order.save();

    // Báo Telegram cho khách
    bot.sendMessage(user.telegramId, `🎉 Chúc mừng! Bạn vừa đổi thành công quà: ${gift.name}.\nĐơn của bạn đang được hệ thống xử lý.`);

    res.json({ success: true, message: "Đổi quà thành công" });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// API: CMS - QUẢN LÝ QUÀ TẶNG
app.get('/api/gifts', async (req, res) => {
  const gifts = await Gift.find().sort({ createdAt: -1 });
  res.json({ success: true, gifts });
});

app.post('/api/gifts', async (req, res) => {
  try {
    const newGift = new Gift(req.body);
    await newGift.save();
    res.json({ success: true, gift: newGift });
  } catch (error) { res.status(500).json({ success: false, message: error.message }); }
});

app.put('/api/gifts/:id', async (req, res) => {
  try {
    const updated = await Gift.findByIdAndUpdate(req.params.id, req.body, { new: true });
    res.json({ success: true, gift: updated });
  } catch (error) { res.status(500).json({ success: false, message: error.message }); }
});

app.delete('/api/gifts/:id', async (req, res) => {
  try {
    await Gift.findByIdAndDelete(req.params.id);
    res.json({ success: true });
  } catch (error) { res.status(500).json({ success: false, message: error.message }); }
});

// API: CMS - QUẢN LÝ KHÁCH HÀNG (USERS)
app.get('/api/users', async (req, res) => {
  const { search } = req.query;
  let query = {};
  if (search) {
    query = { 
      $or: [
        { firstName: new RegExp(search, 'i') }, 
        { username: new RegExp(search, 'i') }, 
        { telegramId: new RegExp(search, 'i') }
      ] 
    };
  }
  const users = await User.find(query).sort({ joinedAt: -1 });
  res.json({ success: true, users });
});

app.get('/api/users/telegram/:telegramId', async (req, res) => {
  try {
    const user = await User.findOne({ telegramId: req.params.telegramId });
    if (!user) return res.status(404).json({ success: false });
    res.json({ success: true, user });
  } catch (error) { res.status(500).json({ success: false, message: error.message }); }
});

app.get('/api/users/telegram/:telegramId/history', async (req, res) => {
  try {
    const user = await User.findOne({ telegramId: req.params.telegramId });
    if (!user) return res.status(404).json({ success: false });
    
    const orders = await Order.find({ user: user._id }).populate('gift').sort({ createdAt: -1 });
    
    const history = orders.map(o => {
      let statusStr = o.status === 'COMPLETED' ? ' (Đã trao)' : (o.status === 'PENDING' ? ' (Đang xử lý)' : ' (Đã hủy)');
      return {
        id: o._id.toString(),
        date: new Date(o.createdAt).toLocaleDateString('vi-VN'),
        type: 'minus',
        points: o.gift ? o.gift.points : 0,
        reason: `Đổi quà: ${o.gift ? o.gift.name : 'Quà đã xóa'}` + statusStr,
        giftImage: o.giftImage || (o.gift ? o.gift.image : null)
      };
    });
    
    res.json({ success: true, history });
  } catch (error) { res.status(500).json({ success: false, message: error.message }); }
});

app.put('/api/users/:id/points', async (req, res) => {
  const { points, depositCurrentMonth } = req.body;
  try {
    const user = await User.findById(req.params.id);
    if (!user) return res.status(404).json({ success: false });
    
    // Nếu điểm thay đổi, báo Telegram
    if (points !== undefined && points > user.points) {
       bot.sendMessage(user.telegramId, `💰 Bạn vừa được cộng ${points - user.points} điểm từ hệ thống. Tổng điểm hiện tại: ${points}`);
    }
    
    if (points !== undefined) user.points = points;
    if (depositCurrentMonth !== undefined) user.depositCurrentMonth = depositCurrentMonth;
    
    await user.save();
    res.json({ success: true, user });
  } catch (error) { res.status(500).json({ success: false, message: error.message }); }
});

// API: CMS - QUẢN LÝ ĐƠN ĐỔI QUÀ
app.get('/api/orders', async (req, res) => {
  const orders = await Order.find().populate('user').populate('gift').sort({ createdAt: -1 });
  res.json({ success: true, orders });
});

app.put('/api/orders/:id/status', async (req, res) => {
  const { status } = req.body;
  try {
    const order = await Order.findById(req.params.id).populate('user').populate('gift');
    if (!order) return res.status(404).json({ success: false });

    order.status = status;
    await order.save();

    if (status === 'COMPLETED') {
       bot.sendMessage(order.user.telegramId, `🎁 Đơn đổi quà "${order.gift.name}" của bạn đã được xử lý thành công!`);
    }

    res.json({ success: true, order });
  } catch (error) { res.status(500).json({ success: false, message: error.message }); }
});

app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
