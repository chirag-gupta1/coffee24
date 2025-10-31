// -------------------------
// 📦 Imports & Config
// -------------------------
const express = require('express');
const path = require('path');
const mongoose = require('mongoose');
const session = require('express-session');
const MongoStore = require('connect-mongo');
const bcrypt = require('bcrypt');
const bodyParser = require('body-parser');
const dotenv = require('dotenv');
const moment = require('moment');
const PDFDocument = require('pdfkit');

dotenv.config();

const Admin = require('./models/Admin');
const Machine = require('./models/Machine');
const Record = require('./models/Record');

const app = express();
const PORT = process.env.PORT || 3000;
const MONGO_URI = process.env.MONGODB_URI;


// -------------------------
// Database Connection
// -------------------------
mongoose.connect(MONGO_URI, { useNewUrlParser: true, useUnifiedTopology: true })
  .then(() => console.log('MongoDB connected'))
  .catch(err => console.error('MongoDB error', err));


// -------------------------
// Middleware Setup
// -------------------------
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.static(path.join(__dirname, 'public')));
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.json());

app.use(session({
  secret: process.env.SESSION_SECRET || 'dev_secret',
  resave: false,
  saveUninitialized: false,
  store: MongoStore.create({
    mongoUrl: MONGO_URI,
    ttl: 60 * 60 * 8 // 8 hours cleanup in DB, doesn’t affect browser cookie
  }),
  cookie: {
    maxAge: null,     // 🔹 No expiry = browser deletes cookie when closed
    sameSite: 'lax',
    secure: false     // change to true if using HTTPS in production
  }
}));



// -------------------------
// Auth Middleware
// -------------------------
function requireAuth(req, res, next) {
  if (req.session && req.session.adminId) return next();
  return res.redirect('/login');
}


// -------------------------
// Seed Admin + Machines
// -------------------------
async function seed() {
  const adminUser = process.env.ADMIN_USERNAME || 'parteekbhardwaj';
  const adminPass = process.env.ADMIN_PASSWORD || 'coffee24parteek';

  try {
    const existing = await Admin.findOne({ username: adminUser });
    if (!existing) {
      const hash = await bcrypt.hash(adminPass, 10);
      await Admin.create({ username: adminUser, passwordHash: hash });
      console.log('Admin seeded');
    }

    const count = await Machine.countDocuments();
    if (count === 0) {
      const seedData = require('./seed/machines.json');
      await Machine.insertMany(seedData);
      console.log('Machines seeded');
    }
  } catch (e) {
    console.error('Seed error:', e);
  }
}
seed();


// -------------------------
// Global Variable (today’s date)
// -------------------------
app.use((req, res, next) => {
  res.locals.today = moment().format('YYYY-MM-DD');
  next();
});


// -------------------------
// Routes
// -------------------------

// Home
app.get('/', requireAuth, (req, res) => res.render('home'));


// -------------------------
// Authentication
// -------------------------
app.get('/login', (req, res) => res.render('login', { error: null }));

app.post('/login', async (req, res) => {
  const { username, password } = req.body;
  const admin = await Admin.findOne({ username });

  if (!admin) return res.render('login', { error: 'Invalid credentials' });
  const ok = await bcrypt.compare(password, admin.passwordHash);
  if (!ok) return res.render('login', { error: 'Invalid credentials' });

  req.session.adminId = admin._id;
  res.redirect('/');
});

app.get('/logout', (req, res) => req.session.destroy(() => res.redirect('/login')));


// -------------------------
// Dashboard
// -------------------------
app.get('/dashboard', requireAuth, async (req, res) => {
  try {
    const machines = await Machine.find().sort({ code: 1 });

    // Compute totals only for selected machines
    const totals = {};
    machines.forEach(m => {
      if (m.isActive) {
        m.ingredients.forEach(ing => {
          // Ensure we're working with numbers and handle any data issues
          const quantity = Number(ing.predefinedQuantity) || 0;
          if (typeof ing.name === 'string') {
            totals[ing.name] = (totals[ing.name] || 0) + quantity;
          }
        });
      }
    });

    res.render('dashboard', { machines, totals });
  } catch (err) {
    console.error('Error loading dashboard:', err);
    res.status(500).send('Error loading dashboard');
  }
});



// -------------------------
// Machine Edit & Save
// -------------------------
app.get('/machine/new', async (req, res) => {
  try {
    // Default ingredient list — replace with Excel-based list later if needed
    const defaultIngredients = [
      { name: 'White Coffee', quantity: 0 },
      { name: 'Black Coffee', quantity: 0 },
      { name: 'Milk', quantity: 0 },
      { name: 'Chocolate', quantity: 0 },
      { name: 'French Vanilla', quantity: 0 },
      { name: 'Chai Tea', quantity: 0 },
      { name: 'English Toffee', quantity: 0 },
      { name: 'Hazelnut', quantity: 0 },
      { name: 'Pumpkin Spice', quantity: 0 },
      { name: 'Cardamom Tea', quantity: 0 },
      { name: 'Masala Tea', quantity: 0 },
      { name: 'Decaf', quantity: 0 },
      { name: '8OZ Cup Sleeves', quantity: 0 },
      { name: '10OZ Cup Sleeves', quantity: 0 },
      { name: 'Water Jugs', quantity: 0 },
    ];

    // Send a "blank machine" with ingredients prefilled
    const machine = {
      _id: 'new',
      code: '',
      model: '',
      location: '',
      ingredients: defaultIngredients
    };

    res.render('machine', { machine });
  } catch (err) {
    console.error('Error loading new machine form:', err);
    res.status(500).send('Error loading machine form');
  }
});


app.post('/machine/new', requireAuth, async (req, res) => {
  try {
    const { code, model, location } = req.body;
    
    const allIngredients = [
      'White Coffee', 'Black Coffee', 'Milk', 'Chocolate', 'French Vanilla', 
      'Chai Tea', 'English Toffee', 'Hazelnut', 'Pumpkin Spice', 
      'Cardamom Tea', 'Masala Tea', 'Decaf', '80OZ Cup sleeves', 
      '10OZ Cup Sleeves', 'Water Jugs'
    ];

    // Build ingredients array with predefined quantities from form
    const ingredients = allIngredients.map(name => {
      const predefinedValue = req.body['predefined_' + name];
      return {
        name: name,
        predefinedQuantity: predefinedValue ? parseFloat(predefinedValue) : 0,
        currentQuantity: 0
      };
    });

    const newMachine = new Machine({
      code,
      model,
      location,
      isActive: false,
      ingredients
    });
    
    await newMachine.save();
    res.redirect('/dashboard');
  } catch (err) {
    console.error('Error creating machine:', err);
    res.status(500).send('Error creating machine');
  }
});

app.post('/machine/:id/delete', requireAuth, async (req, res) => {
  try {
    await Machine.findByIdAndDelete(req.params.id);
    res.redirect('/dashboard');
  } catch (err) {
    console.error('Error deleting machine:', err);
    res.status(500).send('Error deleting machine');
  }
});

app.get('/machine/:id', requireAuth, async (req, res) => {
  const machine = await Machine.findById(req.params.id);
  if (!machine) return res.redirect('/dashboard');

  res.render('machine', { machine, quantities: [0, 0.25, 0.5, 1, 2] });
});

app.post('/machine/:id/toggle', requireAuth, async (req, res) => {
  try {
    const machine = await Machine.findById(req.params.id);
    machine.isSelected = !machine.isSelected;
    await machine.save();
    res.json({ success: true, isSelected: machine.isSelected });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false });
  }
});


// server.js
app.post('/machine/:id/edit', async (req, res) => {
  try {
    const { id } = req.params;
    const { code, model, location } = req.body;
    let { ingredients } = req.body;

    if (ingredients && typeof ingredients === 'object' && !Array.isArray(ingredients)) {
      ingredients = Object.values(ingredients);
    }

    const formattedIngredients = Array.isArray(ingredients)
      ? ingredients.map(ing => ({
          name: ing.name?.trim(),
          quantity: parseFloat(ing.quantity) || 0
        }))
      : [];

    if (id === 'new') {
      // Add new machine
      await Machine.create({ code, model, location, ingredients: formattedIngredients });
    } else {
      // Update existing machine
      await Machine.findByIdAndUpdate(id, {
        code,
        model,
        location,
        ingredients: formattedIngredients
      });
    }

    res.redirect('/dashboard');
  } catch (err) {
    console.error('❌ Error saving machine:', err);
    res.status(500).send('Error saving machine');
  }
});


app.get('/totals', requireAuth, async (req, res) => {
  try {
    const selectedMachines = await Machine.find({ isSelected: true });
    const totals = {};
    selectedMachines.forEach(m => {
      m.ingredients.forEach(ing => {
        totals[ing.name] = (totals[ing.name] || 0) + Number(ing.quantity || 0);
      });
    });
    res.json(totals);
  } catch (err) {
    console.error('Error computing totals:', err);
    res.status(500).json({});
  }
});

app.post('/machine/:id/save', requireAuth, async (req, res) => {
  try {
    const machine = await Machine.findById(req.params.id);
    if (!machine) return res.redirect('/dashboard');

    // Update ingredient quantities
    const allIngredients = [
      'White Coffee', 'Black Coffee', 'Milk', 'Chocolate', 'French Vanilla', 
      'Chai Tea', 'English Toffee', 'Hazelnut', 'Pumpkin Spice', 
      'Cardamom Tea', 'Masala Tea', 'Decaf', '80OZ Cup sleeves', 
      '10OZ Cup Sleeves', 'Water Jugs'
    ];

    machine.ingredients = allIngredients.map(name => {
      // Safely parse the values - handle cases where they might be strings or numbers
      const predefinedValue = req.body['predefined_' + name];
      const currentValue = req.body['current_' + name];
      
      return {
        name: name, // Use the name from our array directly
        predefinedQuantity: predefinedValue ? parseFloat(predefinedValue) : 0,
        currentQuantity: currentValue ? parseFloat(currentValue) : 0
      };
    });

    await machine.save();
    res.redirect('/dashboard');
  } catch (err) {
    console.error('Error saving machine:', err);
    res.status(500).send('Error saving machine');
  }
});


// -------------------------
// Save Final Report
// -------------------------
// Save final report for the day and reset all machines
app.post('/save-report', requireAuth, async (req, res) => {
  try {
    // Step 1: Find selected machines
    const machines = await Machine.find({ isSelected: true });

    // Step 2: Calculate totals
    const totals = {};
    machines.forEach(m => {
      m.ingredients.forEach(ing => {
        totals[ing.name] = (totals[ing.name] || 0) + Number(ing.quantity || 0);
      });
    });

    // Step 3: Save report to records collection
    const today = moment().format('YYYY-MM-DD');
    await Record.findOneAndUpdate(
      { date: today },
      { date: today, totals },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );

    // ✅ Step 4: Reset all checkboxes (unselect all machines)
    await Machine.updateMany({}, { $set: { isSelected: false } });

    console.log('Report saved and selections reset.');
    res.redirect('/records');
  } catch (err) {
    console.error('Error saving report:', err);
    res.status(500).send('Error saving report');
  }
});





// -------------------------
// View & Manage Reports
// -------------------------
app.get('/records', requireAuth, async (req, res) => {
  const records = await Record.find().sort({ date: -1 });
  res.render('records', { records, today: moment().format('YYYY-MM-DD') });
});

app.get('/record/:id', requireAuth, async (req, res) => {
  const record = await Record.findById(req.params.id);
  if (!record) return res.redirect('/records');
  res.render('record-view', { record });
});

// AJAX Delete Route
app.delete('/record/:id', requireAuth, async (req, res) => {
  console.log('🟡 DELETE request for record:', req.params.id);
  try {
    const deleted = await Record.findByIdAndDelete(req.params.id);
    if (!deleted) return res.status(404).json({ success: false, message: 'Record not found' });

    console.log(`Deleted record for date: ${deleted.date}`);
    res.json({ success: true, message: 'Record deleted successfully' });
  } catch (err) {
    console.error('Error deleting record:', err);
    res.status(500).json({ success: false, message: 'Server error while deleting record' });
  }
});


// -------------------------
// Generate Reports (TXT or PDF)
// -------------------------
app.post('/generate-report', requireAuth, async (req, res) => {
  const { type, date, allDates } = req.body;
  let records;

  if (allDates === 'on') {
    records = await Record.find().sort({ date: 1 });
  } else {
    const target = date || moment().format('YYYY-MM-DD');
    const r = await Record.findOne({ date: target });
    records = r ? [r] : [];
  }

  // TXT Report
  if (type === 'txt') {
    let lines = [];

    records.forEach(r => {
      lines.push(`Coffee Ingredients Report`);
      lines.push(`Date: ${r.date}`);
      lines.push('');
      lines.push(`-----------------------------------`);
      lines.push(`Ingredient Name         Quantity`);
      lines.push(`-----------------------------------`);

      Object.keys(r.totals).forEach(name => {
        const qty = r.totals[name].toString().padEnd(5, ' ');
        lines.push(`${name.padEnd(22, ' ')} ${qty}`);
      });

      lines.push(`-----------------------------------`);
      lines.push('');
    });

    const filename = `report_${Date.now()}.txt`;
    res.setHeader('Content-Disposition', `attachment; filename=${filename}`);
    res.setHeader('Content-Type', 'text/plain');
    return res.send(lines.join('\n'));
  }

  // PDF Report
  const PDFDocument = require('pdfkit');
  const doc = new PDFDocument({ margin: 40, size: 'A4' });
  const filename = `report_${Date.now()}.pdf`;

  res.setHeader('Content-Disposition', `attachment; filename=${filename}`);
  res.setHeader('Content-Type', 'application/pdf');
  doc.pipe(res);

  // Title styling
  doc.fontSize(18).text('Coffee Ingredients Report', { align: 'center' });
  doc.moveDown(0.5);

  records.forEach((r, index) => {
    doc.fontSize(12).text(`Date: ${r.date}`, { align: 'center' });
    doc.moveDown(1);

    // Table header
    const tableTop = doc.y;
    const col1X = 120;
    const col2X = 340;
    const rowHeight = 22;

    doc.font('Helvetica-Bold');
    doc.text('Ingredient', col1X, tableTop);
    doc.text('Quantity', col2X, tableTop);
    doc.moveDown(0.5);
    doc.font('Helvetica').moveTo(col1X - 10, tableTop + 15).lineTo(480, tableTop + 15).stroke();

    // Table rows
    Object.keys(r.totals).forEach((name, i) => {
      const y = tableTop + 25 + i * rowHeight;
      doc.text(name, col1X, y);
      doc.text(r.totals[name].toString(), col2X, y);
    });

    // Page separation
    if (index < records.length - 1) doc.addPage();
  });

  doc.end();
});



// -------------------------
// Start Server
// -------------------------
process.on('uncaughtException', err => {
  console.error('UNCAUGHT EXCEPTION:', err);
});

process.on('unhandledRejection', err => {
  console.error('UNHANDLED REJECTION:', err);
});

app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));