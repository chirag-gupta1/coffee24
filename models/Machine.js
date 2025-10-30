const mongoose = require('mongoose');
const Schema = mongoose.Schema;
const IngredientSchema = new Schema({
  name: String,
  quantity: {type:Number, default:0}
}, {_id:false});

const MachineSchema = new Schema({
  code: String,
  model: String,
  location: String,
  ingredients: [IngredientSchema]
});

module.exports = mongoose.model('Machine', MachineSchema);
