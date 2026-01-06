require("dotenv").config()
const express = require("express")
const mongoose = require("mongoose")
const bcrypt = require("bcryptjs")
const jwt = require("jsonwebtoken")
const cors = require("cors")

const User = require("./models/User")
const { MercadoPagoConfig, PreApproval } = require("mercadopago")

const app = express()

// =======================
// LOGS DE DIAGNÓSTICO (CRÍTICO)
// =======================
console.log("🚀 Server.js iniciado com sucesso");
console.log("ENV:", {
  NODE_ENV: process.env.NODE_ENV,
  PORT: process.env.PORT,
  FRONTEND_URL: process.env.FRONTEND_URL
});
// =======================
// CORS (Frontend .com.br → Backend .com)
// =======================
app.use(cors({
  origin: [
    "https://quimicavestibular.com.br",
    "https://www.quimicavestibular.com.br"
  ],
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"],
  credentials: false
}))

app.use(express.json())

// =======================
// HEALTH CHECK
// =======================
app.get("/api/health", (req, res) => {
  res.json({ status: "ok" })
})

// =======================
// MERCADO PAGO
// =======================
const mpClient = new MercadoPagoConfig({
  accessToken: process.env.MERCADOPAGO_ACCESS_TOKEN
})

const preApproval = new PreApproval(mpClient)

// =======================
// ROOT
// =======================
app.get("/", (req, res) => {
  res.json({ status: "API online 🚀" })
})

// =======================
// MONGODB
// =======================
mongoose
  .connect(process.env.MONGO_URI)
  .then(() => console.log("MongoDB conectado"))
  .catch(err => console.error("Erro MongoDB:", err))

// =======================
// JWT
// =======================
const checkToken = (req, res, next) => {
  const authHeader = req.headers.authorization
  const token = authHeader?.split(" ")[1]

  if (!token) return res.status(401).json({ msg: "Token ausente" })

  try {
    req.user = jwt.verify(token, process.env.SECRET)
    next()
  } catch {
    res.status(401).json({ msg: "Token inválido" })
  }
}

// =======================
// REGISTER
// =======================
app.post("/auth/register", async (req, res) => {
  try {
    const { nome, email, senha, telefone } = req.body

    const exists = await User.findOne({ email })
    if (exists) return res.status(409).json({ msg: "Email já cadastrado" })

    const hash = await bcrypt.hash(senha, 12)

    const user = await User.create({
      nome,
      email,
      senha: hash,
      telefone,
      assinatura: false
    })

    const token = jwt.sign({ id: user._id }, process.env.SECRET, {
      expiresIn: "1d"
    })

    res.json({ token })
  } catch (err) {
    console.error("Erro register:", err)
    res.status(500).json({ msg: "Erro ao cadastrar usuário" })
  }
})

// =======================
// LOGIN
// =======================
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
// ASSINATURA
// =======================
app.post("/assinatura", checkToken, async (req, res) => {
  try {
    const user = await User.findById(req.user.id)

    const response = await preApproval.create({
      reason: "Assinatura Mensal - Plataforma QuimITA",
      payer: { email: user.email },
      auto_recurring: {
        frequency: 1,
        frequency_type: "months",
        transaction_amount: 39.9,
        currency_id: "BRL"
      },
      back_urls: {
        success: `${process.env.FRONTEND_URL}/sucesso`,
        failure: `${process.env.FRONTEND_URL}/erro`,
        pending: `${process.env.FRONTEND_URL}/pendente`
      },
      external_reference: user._id.toString()
    })

    user.assinaturaId = response.id
    user.assinaturaStatus = response.status
    user.assinaturaCriadaEm = new Date()
    await user.save()

    res.json({ init_point: response.init_point })
  } catch (err) {
    console.error("Erro Mercado Pago:", err)
    res.status(500).json({ msg: "Erro ao criar assinatura" })
  }
})

// =======================
// WEBHOOK (SEM CORS)
// =======================
app.post("/webhook/mercadopago", async (req, res) => {
  try {
    const subscriptionId = req.body?.data?.id || req.body?.id
    if (!subscriptionId) return res.sendStatus(200)

    const subscription = await preApproval.get({ id: subscriptionId })

    await User.findOneAndUpdate(
      { assinaturaId: subscriptionId },
      {
        assinatura: subscription.status === "authorized",
        assinaturaStatus: subscription.status
      }
    )

    res.sendStatus(200)
  } catch (err) {
    console.error("Erro webhook:", err)
    res.sendStatus(500)
  }
})

// =======================
// START (RENDER)
// =======================
const PORT = process.env.PORT || 3000

app.listen(PORT, "0.0.0.0", () => {
  console.log(`🚀 Servidor rodando na porta ${PORT}`)
})
