const mongoose = require('mongoose');
const Schema = mongoose.Schema;
const RecordSchema = new Schema({
  date: {type:String, required:true, unique:true},
  totals: {type: Schema.Types.Mixed, default: {} }
});
module.exports = mongoose.model('Record', RecordSchema);
