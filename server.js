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
// 🔍 LOGS DE START (CRÍTICO)
// =======================
console.log("🚀 Server.js iniciado")
console.log("NODE_ENV:", process.env.NODE_ENV)
console.log("PORT:", process.env.PORT)
console.log("FRONTEND_URL:", process.env.FRONTEND_URL)
console.log("MONGO_URI existe?", !!process.env.MONGO_URI)
console.log(
  "MP TOKEN existe?",
  !!process.env.MERCADOPAGO_ACCESS_TOKEN
)

// =======================
// CORS
// =======================
app.use(cors({
  origin: [
    "https://quimicavestibular.com.br",
    "https://www.quimicavestibular.com.br"
  ],
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"],
  credentials: true
}))

app.use(express.json())

// =======================
// HEALTH CHECK
// =======================
app.get("/api/health", (req, res) => {
  console.log("🩺 Health check chamado")
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
  .then(() => console.log("✅ MongoDB conectado"))
  .catch(err => {
    console.error("❌ Erro MongoDB:", err)
  })

// =======================
// JWT
// =======================
const checkToken = (req, res, next) => {
  const authHeader = req.headers.authorization
  const token = authHeader?.split(" ")[1]

  if (!token) {
    console.log("❌ Token ausente")
    return res.status(401).json({ msg: "Token ausente" })
  }

  try {
    req.user = jwt.verify(token, process.env.SECRET)
    next()
  } catch (err) {
    console.log("❌ Token inválido")
    res.status(401).json({ msg: "Token inválido" })
  }
}

// =======================
// REGISTER
// =======================
app.post("/auth/register", async (req, res) => {
  try {
    console.log("📥 REGISTER chamado:", req.body.email)

    const { nome, email, senha, telefone } = req.body

    const exists = await User.findOne({ email })
    if (exists) {
      console.log("⚠️ Email já cadastrado:", email)
      return res.status(409).json({ msg: "Email já cadastrado" })
    }

    const hash = await bcrypt.hash(senha, 12)

    const user = await User.create({
      nome,
      email,
      senha: hash,
      telefone,
      assinatura: false
    })

    console.log("✅ Usuário criado:", user._id)

    const token = jwt.sign({ id: user._id }, process.env.SECRET, {
      expiresIn: "1d"
    })

    res.json({ token })
  } catch (err) {
    console.error("❌ Erro register:", err)
    res.status(500).json({ msg: "Erro ao cadastrar usuário" })
  }
})

// =======================
// LOGIN
// =======================
app.post("/auth/login", async (req, res) => {
  try {
    console.log("📥 LOGIN chamado:", req.body.email)

    const { email, senha } = req.body

    const user = await User.findOne({ email })
    if (!user) {
      console.log("❌ Usuário não encontrado")
      return res.status(404).json({ msg: "Usuário não encontrado" })
    }

    const ok = await bcrypt.compare(senha, user.senha)
    if (!ok) {
      console.log("❌ Senha inválida")
      return res.status(401).json({ msg: "Senha inválida" })
    }

    const token = jwt.sign({ id: user._id }, process.env.SECRET)
    res.json({ token })
  } catch (err) {
    console.error("❌ Erro login:", err)
    res.status(500).json({ msg: "Erro no login" })
  }
})

// =======================
// PERFIL
// =======================
app.get("/user/perfil", checkToken, async (req, res) => {
  console.log("👤 Perfil solicitado:", req.user.id)

  const user = await User.findById(req.user.id).select("-senha")
  res.json(user)
})

// =======================
// ASSINATURA (🔥 MAIS IMPORTANTE)
// =======================
app.post("/assinatura", checkToken, async (req, res) => {
  try {
    console.log("💳 Criar assinatura - usuário:", req.user.id)

    const user = await User.findById(req.user.id)
    console.log("📧 Email:", user.email)

    const payload = {
      reason: 'Assinatura Mensal - Plataforma QuimITA',
      payer_email: user.email,

      auto_recurring: {
        frequency: 1,
        frequency_type: 'months',
        transaction_amount: 10,
        currency_id: 'BRL'
      },
      back_url: 'https://quimicavestibular.com.br/sucesso',
      external_reference: user._id.toString()
    }



    console.log("📤 Payload Mercado Pago:", payload)

    const response = await preApproval.create({
     body: payload
    })

    console.log("✅ Mercado Pago resposta:", response)

    user.assinaturaId = response.id
    user.assinaturaStatus = response.status
    user.assinaturaCriadaEm = new Date()
    await user.save()

    res.json({ init_point: response.init_point })
  } catch (err) {
    console.error("❌ Erro Mercado Pago:", err)
    res.status(500).json({ msg: "Erro ao criar assinatura" })
  }
})

// =======================
// WEBHOOK
// =======================
app.post("/webhook/mercadopago", async (req, res) => {
  console.log("📩 Webhook recebido:", req.body)
  res.sendStatus(200)
})

// =======================
// START (RENDER)
// =======================
const PORT = process.env.PORT || 3000

app.listen(PORT, "0.0.0.0", () => {
  console.log(`✅ Servidor rodando na porta ${PORT}`)
})
