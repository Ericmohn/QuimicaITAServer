/* eslint-disable no-undef */
const mongoose = require("mongoose")

const UserSchema = new mongoose.Schema(
  {
    // =========================
    // DADOS BÁSICOS
    // =========================
    nome: {
      type: String,
      required: true,
    },

    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
    },

    senha: {
      type: String,
      required: true,
    },

    // =========================
    // DADOS PESSOAIS
    // =========================
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

    // ID do PreApproval (Mercado Pago)
    assinaturaId: {
      type: String,
      default: null,
    },

    // inactive | pending | active
    assinaturaStatus: {
      type: String,
      enum: ["inactive", "pending", "active"],
      default: "inactive",
    },

    // Bloqueia múltiplas reativações
    assinaturaEmProcesso: {
      type: Boolean,
      default: false,
    },

    assinaturaCriadaEm: {
      type: Date,
      default: null,
    },

    assinaturaAtualizadaEm: {
      type: Date,
      default: null,
    },

    // =========================
    // RECUPERAÇÃO DE SENHA
    // =========================
    resetPasswordToken: {
      type: String,
      default: null,
    },

    resetPasswordExpires: {
      type: Date,
      default: null,
    },
  },
  {
    timestamps: true, // createdAt / updatedAt
  }
)

const User = mongoose.model("User", UserSchema)

module.exports = User
