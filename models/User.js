/* eslint-disable no-undef */
const mongoose = require("mongoose");

const UserSchema = mongoose.Schema({
  nome: String,
  email: String,
  senha: String,

  cpf: String,
  telefone: String,
  endereco: String,
  complemento: String,
  cep: String,
  cidade: String,
  estado: String,

  // Controle de assinatura
  assinatura: {
    type: Boolean,
    default: false,
  },

  // Mercado Pago
  assinaturaId: {
    type: String, // preapproval_id
  },

  assinaturaStatus: {
    type: String, // authorized | cancelled | paused
    default: "inactive",
  },

  assinaturaCriadaEm: {
    type: Date,
  },
});

const User = mongoose.model("User", UserSchema);

module.exports = User;
