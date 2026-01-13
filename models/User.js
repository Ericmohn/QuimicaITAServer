/* eslint-disable no-undef */
const mongoose = require("mongoose")

const UserSchema = mongoose.Schema({
  nome: String,
  email: String,
  senha: String,

  resetPasswordToken: String,
  resetPasswordExpires: Date,

  cpf: String,
  telefone: String,
  endereco: String,
  complemento: String,
  cep: String,
  cidade: String,
  estado: String,

  // =========================
  // CONTROLE DE ASSINATURA
  // =========================
  assinatura: {
    type: Boolean,
    default: false,
  },

  assinaturaId: {
    type: String, // preapproval_id
  },

  assinaturaStatus: {
    type: String,
    default: "inactive",
  },

  assinaturaCriadaEm: {
    type: Date,
  },

  // =========================
  // RECUPERAÇÃO DE SENHA
  // =========================
  resetPasswordToken: {
    type: String,
  },

  resetPasswordExpires: {
    type: Date,
  },
})

const User = mongoose.model("User", UserSchema)

module.exports = User
