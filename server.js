require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const TelegramBot = require('node-telegram-bot-api');

const app = express();
app.use(cors());
app.use(express.json());

// Kết nối MongoDB (Hỗ trợ Serverless Vercel)
let isConnecting = null;
const connectDb = async () => {
  if (mongoose.connection.readyState === 1) {
    return;
  }

  // Nếu đang trong quá trình kết nối, đợi kết nối hoàn thành
  if (mongoose.connection.readyState === 2) {
    await new Promise((resolve) => {
      const interval = setInterval(() => {
        if (mongoose.connection.readyState === 1) {
          clearInterval(interval);
          resolve();
        }
      }, 50);
    });
    return;
  }

  if (process.env.MONGODB_URI) {
    if (!isConnecting) {
      isConnecting = mongoose.connect(process.env.MONGODB_URI)
        .then((m) => {
          console.log("MongoDB Connected");
          isConnecting = null;
          return m;
        })
        .catch(err => {
          console.log("MongoDB Error:", err);
          isConnecting = null;
          throw err;
        });
    }
    await isConnecting;
  } else {
    console.warn("WARNING: MONGODB_URI is not defined in environment variables!");
  }
};

// Khởi tạo kết nối ban đầu
connectDb().catch(() => {});

// Middleware đảm bảo kết nối DB trước khi xử lý request
const ensureDbConnected = async (req, res, next) => {
  try {
    await connectDb();
    next();
  } catch (error) {
    res.status(500).json({ success: false, message: "Lỗi kết nối cơ sở dữ liệu: " + error.message });
  }
};

app.use(ensureDbConnected);

const PORT = process.env.PORT || 3000;
const TELEGRAM_TOKEN = process.env.TELEGRAM_BOT_TOKEN;

// Kiểm tra môi trường Vercel
const isVercel = process.env.VERCEL === '1' || process.env.VERCEL === 'true' || !!process.env.VERCEL;

// Khởi tạo Telegram Bot
let bot;
if (TELEGRAM_TOKEN) {
  // Xác định xem có bật polling hay không:
  // 1. Ưu tiên cấu hình TELEGRAM_POLLING từ environment variable ('true' -> bật, 'false' -> tắt).
  // 2. Nếu không cấu hình: bật polling khi chạy ở local (không phải Vercel và không phải production).
  let shouldPoll = false;
  if (process.env.TELEGRAM_POLLING !== undefined) {
    shouldPoll = process.env.TELEGRAM_POLLING === 'true';
  } else {
    shouldPoll = !isVercel && process.env.NODE_ENV !== 'production';
  }

  bot = new TelegramBot(TELEGRAM_TOKEN, { polling: shouldPoll });
  
  if (shouldPoll) {
    console.log("Telegram Bot started in POLLING mode");
  } else {
    console.log("Telegram Bot started in WEBHOOK/API mode (polling disabled)");
  }
} else {
  console.warn("WARNING: TELEGRAM_BOT_TOKEN is not defined in environment variables!");
}

// Kết nối MongoDB được quản lý qua middleware ensureDbConnected ở trên

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
  category: { type: String, enum: ['VOUCHER', 'E-GIFTS', 'THẺ CÀO', 'NẠP GAME', 'DU LỊCH', 'VÉ MÁY BAY', 'VẬT PHẨM'], default: 'VOUCHER' },
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

// Schema Cấu hình Admin
const AdminSettingSchema = new mongoose.Schema({
  key: { type: String, unique: true },
  value: String
});
const AdminSetting = mongoose.model('AdminSetting', AdminSettingSchema);

// Schema Kết quả xổ số hàng ngày (LotteryResult)
const LotteryResultSchema = new mongoose.Schema({
  date: String,
  region: String,
  provinces: String,
  videoUrls: String,
  db: String,
  g1: String,
  g2: String,
  g3: String,
  g4: String,
  g5: String,
  g6: String,
  g7: String,
  g8: String
});
LotteryResultSchema.index({ date: 1, region: 1 }, { unique: true });
const LotteryResult = mongoose.model('LotteryResult', LotteryResultSchema);

// Schema Đặc Biệt Năm (DbNam)
const DbNamSchema = new mongoose.Schema({
  date: { type: String, unique: true },
  number: String
});
const DbNam = mongoose.model('DbNam', DbNamSchema);

// Schema Giải Nhất Năm (G1Nam)
const G1NamSchema = new mongoose.Schema({
  date: { type: String, unique: true },
  number: String
});
const G1Nam = mongoose.model('G1Nam', G1NamSchema);

// Schema Tần Suất Lô Tô (LoTo)
const LoToSchema = new mongoose.Schema({
  number: { type: String, unique: true },
  count: Number,
  lastSeen: Number
});
const LoTo = mongoose.model('LoTo', LoToSchema);

// Schema Lượt chơi Minigame Trúng Thưởng
const MinigameSubmissionSchema = new mongoose.Schema({
  telegram: { type: String, required: true },
  type: { type: String, required: true },
  number: { type: String, default: '' },
  code: { type: String, default: '' },
  createdAt: { type: Date, default: Date.now }
});
const MinigameSubmission = mongoose.model('MinigameSubmission', MinigameSubmissionSchema);

// Bot lắng nghe lệnh /start TOKEN_123
if (bot) {
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
}

// API nhận webhook từ Telegram
app.post('/api/telegram-webhook', async (req, res) => {
  try {
    if (bot) {
      bot.processUpdate(req.body);
    }
    res.sendStatus(200);
  } catch (error) {
    console.error("Webhook processing error:", error);
    res.sendStatus(500);
  }
});

// API hỗ trợ tự động thiết lập Webhook URL với Telegram
app.get('/api/telegram-setup', async (req, res) => {
  let url = process.env.WEBHOOK_URL;
  
  if (!url) {
    const host = req.headers.host;
    const protocol = req.headers['x-forwarded-proto'] || 'https';
    url = `${protocol}://${host}/api/telegram-webhook`;
  }

  try {
    if (!bot) {
      return res.status(400).json({ success: false, error: "Telegram Bot is not configured (missing token)." });
    }

    // Kiểm tra tính hợp lệ của URL đối với Telegram Webhook
    try {
      const parsedUrl = new URL(url);
      const port = parsedUrl.port;
      const hostname = parsedUrl.hostname;
      
      const allowedPorts = ['', '80', '88', '443', '8443'];
      if (!allowedPorts.includes(port)) {
        return res.status(400).json({ 
          success: false, 
          error: `Telegram webhook only allows ports 80, 88, 443, or 8443. Currently using port: '${port}'.`,
          suggestion: "If you are running locally, use ngrok or cloudflared to create a public HTTPS tunnel, and access this setup API via the public tunnel URL."
        });
      }
      
      if (hostname === 'localhost' || hostname === '127.0.0.1') {
        return res.status(400).json({
          success: false,
          error: "Telegram cannot send webhooks to localhost/127.0.0.1.",
          suggestion: "Please use a public URL (like ngrok, cloudflare tunnel, or deployment URL) to setup the webhook."
        });
      }
    } catch (urlError) {
      return res.status(400).json({ success: false, error: `Invalid URL format: ${url}` });
    }

    await bot.setWebHook(url);
    res.json({ success: true, message: `Webhook has been set to: ${url}` });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// API cho Mobile App gọi để lấy Token mới
app.get('/api/auth/generate-token', async (req, res) => {


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
    if (bot) {
      bot.sendMessage(user.telegramId, `🎉 Chúc mừng! Bạn vừa đổi thành công quà: ${gift.name}.\nĐơn của bạn đang được hệ thống xử lý.`);
    }

    res.json({ success: true, message: "Đổi quà thành công" });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// API: CMS - QUẢN LÝ QUÀ TẶNG
app.get('/api/gifts', async (req, res) => {
  try {
    const { category, page, limit } = req.query;
    const filter = {};
    if (category && category !== 'all') filter.category = category;

    const pageNum = Math.max(1, parseInt(page) || 1);
    const parsedLimit = parseInt(limit);
    // 0 hoặc không truyền = không giới hạn; > 0 thì giới hạn tối đa 100
    const limitNum = (!parsedLimit || parsedLimit <= 0) ? 0 : Math.min(100, parsedLimit);

    const total = await Gift.countDocuments(filter);
    const query = Gift.find(filter).sort({ createdAt: -1 });
    if (limitNum > 0) query.skip((pageNum - 1) * limitNum).limit(limitNum);

    const gifts = await query;
    res.json({ success: true, gifts, total, page: pageNum, limit: limitNum });
  } catch (error) { res.status(500).json({ success: false, message: error.message }); }
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
       if (bot) {
         bot.sendMessage(user.telegramId, `💰 Bạn vừa được cộng ${points - user.points} điểm từ hệ thống. Tổng điểm hiện tại: ${points}`);
       }
    }
    
    if (points !== undefined) user.points = points;
    if (depositCurrentMonth !== undefined) user.depositCurrentMonth = depositCurrentMonth;
    
    await user.save();
    res.json({ success: true, user });
  } catch (error) { res.status(500).json({ success: false, message: error.message }); }
});

// API: CMS - QUẢN LÝ ĐƠN ĐỔI QUÀ
app.get('/api/orders', async (req, res) => {
  try {
    const { status, search, page, limit } = req.query;
    const pageNum = Math.max(1, parseInt(page) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(limit) || 20));

    // Build user filter for search
    let userIds = null;
    if (search && search.trim()) {
      const regex = new RegExp(search.trim(), 'i');
      const matchedUsers = await User.find({
        $or: [
          { firstName: regex },
          { username: regex },
          { telegramId: regex },
        ]
      }).select('_id');
      userIds = matchedUsers.map(u => u._id);
    }

    // Build order filter
    const orderFilter = {};
    if (status && status !== 'ALL') orderFilter.status = status;
    if (userIds !== null) orderFilter.user = { $in: userIds };

    // Also search gift name if no user matched but search exists
    // Run parallel: orders matching userIds OR gift name
    let orders, total;
    if (search && search.trim() && userIds !== null && userIds.length === 0) {
      // No users matched – try matching gift name instead
      const giftRegex = new RegExp(search.trim(), 'i');
      const matchedGifts = await Gift.find({ name: giftRegex }).select('_id');
      if (matchedGifts.length > 0) {
        orderFilter.gift = { $in: matchedGifts.map(g => g._id) };
        delete orderFilter.user;
      }
    }

    total = await Order.countDocuments(orderFilter);
    orders = await Order.find(orderFilter)
      .populate('user')
      .populate('gift')
      .sort({ createdAt: -1 })
      .skip((pageNum - 1) * limitNum)
      .limit(limitNum);

    const totalPages = Math.ceil(total / limitNum);
    res.json({ success: true, orders, total, page: pageNum, limit: limitNum, totalPages });
  } catch (error) { res.status(500).json({ success: false, message: error.message }); }
});

app.put('/api/orders/:id/status', async (req, res) => {
  const { status } = req.body;
  try {
    const order = await Order.findById(req.params.id).populate('user').populate('gift');
    if (!order) return res.status(404).json({ success: false });

    order.status = status;
    await order.save();

    if (status === 'COMPLETED') {
       if (bot) {
         bot.sendMessage(order.user.telegramId, `🎁 Đơn đổi quà "${order.gift.name}" của bạn đã được xử lý thành công!`);
       }
    }

    res.json({ success: true, order });
  } catch (error) { res.status(500).json({ success: false, message: error.message }); }
});

// API: QUẢN LÝ MINIGAME
app.post('/api/minigames', async (req, res) => {
  const { telegram, type, number, code } = req.body;
  try {
    if (!telegram || !type) {
      return res.status(400).json({ success: false, message: "Thiếu thông tin telegram hoặc loại minigame." });
    }
    const submission = new MinigameSubmission({
      telegram,
      type,
      number: number || '',
      code: code || ''
    });
    await submission.save();
    res.json({ success: true, message: "Gửi dự đoán minigame thành công!" });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

app.get('/api/minigames', async (req, res) => {
  try {
    const submissions = await MinigameSubmission.find().sort({ createdAt: -1 });
    res.json({ success: true, submissions });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

app.delete('/api/minigames/:id', async (req, res) => {
  try {
    const deleted = await MinigameSubmission.findByIdAndDelete(req.params.id);
    if (!deleted) {
      return res.status(404).json({ success: false, message: "Không tìm thấy lượt chơi." });
    }
    res.json({ success: true, message: "Xóa lượt chơi minigame thành công!" });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

app.post('/api/admin/login', async (req, res) => {
  const { pinCode } = req.body;
  try {
    let pinSetting = await AdminSetting.findOne({ key: 'admin_pin' });
    if (!pinSetting) {
      pinSetting = new AdminSetting({ key: 'admin_pin', value: 'admin888' });
      await pinSetting.save();
    }
    if (pinCode === pinSetting.value) {
      res.json({ success: true, message: "Đăng nhập thành công" });
    } else {
      res.status(401).json({ success: false, message: "Mã PIN bảo mật không chính xác!" });
    }
  } catch (error) {
    res.status(500).json({ success: false, message: "Lỗi máy chủ: " + error.message });
  }
});

app.post('/api/admin/change-pin', async (req, res) => {
  const { currentPin, newPin } = req.body;
  try {
    let pinSetting = await AdminSetting.findOne({ key: 'admin_pin' });
    if (!pinSetting) {
      pinSetting = new AdminSetting({ key: 'admin_pin', value: 'admin888' });
      await pinSetting.save();
    }
    if (currentPin !== pinSetting.value) {
      return res.status(400).json({ success: false, message: "Mã PIN hiện tại không chính xác!" });
    }
    pinSetting.value = newPin;
    await pinSetting.save();
    res.json({ success: true, message: "Thay đổi mã PIN thành công!" });
  } catch (error) {
    res.status(500).json({ success: false, message: "Lỗi máy chủ: " + error.message });
  }
});
app.get('/api/results', async (req, res) => {
  const { date } = req.query;
  if (!date) return res.status(400).json({ success: false, message: "Thiếu tham số date" });
  try {
    const results = await LotteryResult.find({ date });
    const resultsObj = {};
    results.forEach(r => {
      if (!resultsObj[r.date]) resultsObj[r.date] = {};
      resultsObj[r.date][r.region] = {
        db: r.db || "",
        g1: r.g1 || "",
        g2: r.g2 || "",
        g3: r.g3 || "",
        g4: r.g4 || "",
        g5: r.g5 || "",
        g6: r.g6 || "",
        g7: r.g7 || "",
        g8: r.g8 || "",
        provinces: r.provinces || "",
        videoUrls: r.videoUrls || ""
      };
    });
    res.json({ success: true, results: resultsObj });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

app.get('/api/results/year', async (req, res) => {
  const { year } = req.query;
  if (!year) return res.status(400).json({ success: false, message: "Thiếu tham số year" });
  try {
    const yearRegex = new RegExp('^' + year + '-');
    const [dbNamList, g1NamList] = await Promise.all([
      DbNam.find({ date: { $regex: yearRegex } }),
      G1Nam.find({ date: { $regex: yearRegex } })
    ]);

    const dbNamObj = {};
    dbNamList.forEach(item => {
      dbNamObj[item.date] = item.number;
    });

    const g1NamObj = {};
    g1NamList.forEach(item => {
      g1NamObj[item.date] = item.number;
    });

    res.json({ success: true, db_nam: dbNamObj, g1_nam: g1NamObj });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

app.get('/api/results/loto', async (req, res) => {
  try {
    const loToList = await LoTo.find();
    const loToObj = {};
    loToList.forEach(item => {
      loToObj[item.number] = {
        count: item.count,
        lastSeen: item.lastSeen
      };
    });
    res.json({ success: true, lo_to: loToObj });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

app.post('/api/results/sync', async (req, res) => {
  const { results, db_nam, g1_nam, lo_to } = req.body;
  try {
    // 1. Process Results (upsert)
    if (results) {
      const bulkOps = [];
      Object.keys(results).forEach(date => {
        Object.keys(results[date]).forEach(region => {
          const r = results[date][region];
          bulkOps.push({
            updateOne: {
              filter: { date, region },
              update: {
                $set: {
                  provinces: r.provinces || "",
                  videoUrls: r.videoUrls || "",
                  db: r.db || "",
                  g1: r.g1 || "",
                  g2: r.g2 || "",
                  g3: r.g3 || "",
                  g4: r.g4 || "",
                  g5: r.g5 || "",
                  g6: r.g6 || "",
                  g7: r.g7 || "",
                  g8: r.g8 || ""
                }
              },
              upsert: true
            }
          });
        });
      });
      if (bulkOps.length > 0) {
        await LotteryResult.bulkWrite(bulkOps);
      }
    }

    // 2. Process DbNam (upsert)
    if (db_nam) {
      const bulkOps = [];
      Object.keys(db_nam).forEach(date => {
        bulkOps.push({
          updateOne: {
            filter: { date },
            update: { $set: { number: db_nam[date].toString() } },
            upsert: true
          }
        });
      });
      if (bulkOps.length > 0) {
        await DbNam.bulkWrite(bulkOps);
      }
    }

    // 3. Process G1Nam (upsert)
    if (g1_nam) {
      const bulkOps = [];
      Object.keys(g1_nam).forEach(date => {
        bulkOps.push({
          updateOne: {
            filter: { date },
            update: { $set: { number: g1_nam[date].toString() } },
            upsert: true
          }
        });
      });
      if (bulkOps.length > 0) {
        await G1Nam.bulkWrite(bulkOps);
      }
    }

    // 4. Process LoTo (upsert)
    if (lo_to) {
      const bulkOps = [];
      Object.keys(lo_to).forEach(numStr => {
        bulkOps.push({
          updateOne: {
            filter: { number: numStr },
            update: {
              $set: {
                count: Number(lo_to[numStr].count) || 0,
                lastSeen: Number(lo_to[numStr].lastSeen) || 0
              }
            },
            upsert: true
          }
        });
      });
      if (bulkOps.length > 0) {
        await LoTo.bulkWrite(bulkOps);
      }
    }

    res.json({ success: true, message: "Đồng bộ dữ liệu thành công!" });
  } catch (error) {
    res.status(500).json({ success: false, message: "Lỗi đồng bộ dữ liệu: " + error.message });
  }
});
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});

module.exports = app;
