require("dotenv").config()
const express = require("express")
const mongoose = require("mongoose")
const bcrypt = require("bcryptjs")
const jwt = require("jsonwebtoken")
const cors = require("cors")
const crypto = require("crypto")
const axios = require("axios")

const User = require("./models/User")
const { MercadoPagoConfig, PreApproval } = require("mercadopago")

const app = express()

// =======================
// LOGS
// =======================
console.log("🚀 Server iniciado")
console.log("NODE_ENV:", process.env.NODE_ENV)

// =======================
// MIDDLEWARES
// =======================
app.use(
  cors({
    origin: [
      "https://quimicavestibular.com.br",
      "https://www.quimicavestibular.com.br"
    ],
    credentials: true
  })
)

app.use(express.json())

// =======================
// MERCADO PAGO
// =======================
const mpClient = new MercadoPagoConfig({
  accessToken: process.env.MERCADOPAGO_ACCESS_TOKEN
})
const preApproval = new PreApproval(mpClient)

// =======================
// MONGODB
// =======================
mongoose
  .connect(process.env.MONGO_URI)
  .then(() => console.log("✅ MongoDB conectado"))
  .catch(err => console.error("❌ MongoDB erro:", err))

// =======================
// JWT MIDDLEWARE
// =======================
const checkToken = (req, res, next) => {
  const token = req.headers.authorization?.split(" ")[1]
  if (!token) return res.status(401).json({ msg: "Token ausente" })

  try {
    req.user = jwt.verify(token, process.env.SECRET)
    next()
  } catch {
    res.status(401).json({ msg: "Token inválido" })
  }
}

// =======================
// HEALTH
// =======================
app.get("/api/health", (_, res) => {
  res.json({ status: "ok" })
})

// =======================
// AUTH
// =======================
app.post("/auth/register", async (req, res) => {
  const { nome, email, senha, telefone, cpf } = req.body

  if (await User.findOne({ email })) {
    return res.status(409).json({ msg: "Email já cadastrado" })
  }

  const hash = await bcrypt.hash(senha, 12)

  const user = await User.create({
    nome,
    email,
    senha: hash,
    telefone,
    cpf
  })

  const token = jwt.sign({ id: user._id }, process.env.SECRET, {
    expiresIn: "1d"
  })

  res.json({ token })
})

app.post("/auth/login", async (req, res) => {
  const { email, senha } = req.body
  const user = await User.findOne({ email })

  if (!user) return res.status(404).json({ msg: "Usuário não encontrado" })

  const ok = await bcrypt.compare(senha, user.senha)
  if (!ok) return res.status(401).json({ msg: "Senha inválida" })

  const token = jwt.sign({ id: user._id }, process.env.SECRET)
  res.json({ token })
})

// =======================
// PERFIL
// =======================
app.get("/user/perfil", checkToken, async (req, res) => {
  const user = await User.findById(req.user.id).select("-senha")
  res.json(user)
})

// =======================
// CRIAR ASSINATURA
// =======================
app.post("/assinatura", checkToken, async (req, res) => {
  const user = await User.findById(req.user.id)

  if (!user.cpf) {
    return res.status(400).json({
      msg: "CPF é obrigatório para realizar a assinatura"
    })
  }

  if (user.assinaturaEmProcesso) {
    return res.status(400).json({
      msg: "Já existe uma assinatura em processamento"
    })
  }

  const payload = {
    reason: "Assinatura Mensal - QuimITA",
    external_reference: user._id.toString(),

    payer: {
      email: user.email,
      name: user.nome.split(" ")[0],
      surname: user.nome.split(" ").slice(1).join(" ") || "Cliente",
      identification: {
        type: "CPF",
        number: user.cpf
      }
    },

    auto_recurring: {
      frequency: 1,
      frequency_type: "months",
      transaction_amount: 40,
      currency_id: "BRL"
    },

    back_urls: {
      success: `${process.env.FRONTEND_URL}/sucesso`,
      failure: `${process.env.FRONTEND_URL}/erro`,
      pending: `${process.env.FRONTEND_URL}/pendente`
    },

    notification_url: `${process.env.API_URL}/webhook/mercadopago`
  }

  const response = await preApproval.create({ body: payload })

  user.assinaturaId = response.id
  user.assinaturaStatus = "pending"
  user.assinaturaEmProcesso = true
  user.assinatura = false
  await user.save()

  res.json({ init_point: response.init_point })
})

// =======================
// CANCELAR ASSINATURA
// =======================
app.post("/assinatura/cancelar", checkToken, async (req, res) => {
  const user = await User.findById(req.user.id)

  if (!user.assinaturaId) {
    return res.status(400).json({ msg: "Assinatura não encontrada" })
  }

  await preApproval.update({
    id: user.assinaturaId,
    body: { status: "cancelled" }
  })

  user.assinatura = false
  user.assinaturaStatus = "inactive"
  user.assinaturaEmProcesso = false
  await user.save()

  res.json({ success: true })
})

// =======================
// WEBHOOK MERCADO PAGO
// =======================
app.post("/webhook/mercadopago", async (req, res) => {
  try {
    const { data } = req.body
    if (!data?.id) return res.sendStatus(200)

    const mpResp = await preApproval.get({ id: data.id })
    const status = mpResp.status

    const user = await User.findOne({ assinaturaId: data.id })
    if (!user) return res.sendStatus(200)

    if (status === "authorized") {
      user.assinatura = true
      user.assinaturaStatus = "active"
      user.assinaturaEmProcesso = false
      user.assinaturaCriadaEm = new Date()
    }

    if (["paused", "cancelled"].includes(status)) {
      user.assinatura = false
      user.assinaturaStatus = "inactive"
      user.assinaturaEmProcesso = false
    }

    await user.save()
    res.sendStatus(200)
  } catch (err) {
    console.error("❌ Webhook erro:", err)
    res.sendStatus(500)
  }
})

// =======================
// START SERVER
// =======================
const PORT = process.env.PORT || 3000
app.listen(PORT, "0.0.0.0", () =>
  console.log(`✅ Servidor rodando na porta ${PORT}`)
)
