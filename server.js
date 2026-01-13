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
// 🔍 LOGS DE START
// =======================
console.log("🚀 Server.js iniciado")
console.log("NODE_ENV:", process.env.NODE_ENV)
console.log("PORT:", process.env.PORT)
console.log("FRONTEND_URL:", process.env.FRONTEND_URL)
console.log("MONGO_URI existe?", !!process.env.MONGO_URI)
console.log("MP TOKEN existe?", !!process.env.MERCADOPAGO_ACCESS_TOKEN)

// =======================
// CORS
// =======================
app.use(
  cors({
    origin: [
      "https://quimicavestibular.com.br",
      "https://www.quimicavestibular.com.br"
    ],
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
    credentials: true
  })
)

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
// MONGODB
// =======================
mongoose
  .connect(process.env.MONGO_URI)
  .then(() => console.log("✅ MongoDB conectado"))
  .catch(err => console.error("❌ Erro MongoDB:", err))

// =======================
// JWT MIDDLEWARE
// =======================
const checkToken = (req, res, next) => {
  const authHeader = req.headers.authorization
  const token = authHeader?.split(" ")[1]

  if (!token) {
    return res.status(401).json({ msg: "Token ausente" })
  }

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

    if (await User.findOne({ email })) {
      return res.status(409).json({ msg: "Email já cadastrado" })
    }

    const hash = await bcrypt.hash(senha, 12)

    const user = await User.create({
      nome,
      email,
      senha: hash,
      telefone,
      assinatura: false,
      assinaturaStatus: "inactive"
    })

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
    const { email, senha } = req.body

    const user = await User.findOne({ email })
    if (!user) {
      return res.status(404).json({ msg: "Usuário não encontrado" })
    }

    const ok = await bcrypt.compare(senha, user.senha)
    if (!ok) {
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
  const user = await User.findById(req.user.id).select("-senha")
  res.json(user)
})

// =======================
// ASSINATURA
// =======================
app.post("/assinatura", checkToken, async (req, res) => {
  try {
    const user = await User.findById(req.user.id)

    const payload = {
      reason: "Assinatura Mensal - Plataforma QuimITA",
      payer_email: user.email,
      auto_recurring: {
        frequency: 1,
        frequency_type: "months",
        transaction_amount: 40,
        currency_id: "BRL"
      },
      back_url: `${process.env.FRONTEND_URL}/sucesso`,
      external_reference: user._id.toString()
    }

    const response = await preApproval.create({ body: payload })

    user.assinaturaId = response.id
    user.assinaturaStatus = response.status
    user.assinatura = false
    user.assinaturaCriadaEm = new Date()
    await user.save()

    res.json({ init_point: response.init_point })
  } catch (err) {
    console.error("❌ Erro Mercado Pago:", err)
    res.status(500).json({ msg: "Erro ao criar assinatura" })
  }
})

// =======================
// WEBHOOK MERCADO PAGO
// =======================
app.post("/webhook/mercadopago", async (req, res) => {
  try {
    const { type, data } = req.body

    if (type === "preapproval.updated") {
      const user = await User.findOne({ assinaturaId: data.id })
      if (!user) return res.sendStatus(200)

      user.assinaturaStatus = data.status
      user.assinatura = data.status === "active"
      await user.save()
    }

    res.sendStatus(200)
  } catch (err) {
    console.error("❌ Erro webhook:", err)
    res.sendStatus(500)
  }
})

// =======================
// VERIFICA ASSINATURA
// =======================
app.post("/user/verifica-assinatura", checkToken, async (req, res) => {
  const user = await User.findById(req.user.id)

  const ativa =
    user.assinatura === true && user.assinaturaStatus === "active"

  res.json({ assinatura: ativa })
})

// =======================
// RESETAR SENHA (LOGADO)
// =======================
app.post("/user/reset-senha", checkToken, async (req, res) => {
  try {
    const { novaSenha } = req.body

    if (!novaSenha || novaSenha.length < 6) {
      return res
        .status(400)
        .json({ msg: "Senha deve ter no mínimo 6 caracteres" })
    }

    const hash = await bcrypt.hash(novaSenha, 12)

    await User.findByIdAndUpdate(req.user.id, { senha: hash })

    res.json({ ok: true })
  } catch (err) {
    console.error("❌ Erro reset-senha:", err)
    res.status(500).json({ msg: "Erro ao atualizar senha" })
  }
})

// =======================
// ESQUECI MINHA SENHA (EMAIL)
// =======================
app.post("/auth/forgot-password", async (req, res) => {
  try {
    const { email } = req.body
    const user = await User.findOne({ email })

    if (!user) return res.json({ ok: true })

    const token = crypto.randomBytes(32).toString("hex")

    user.resetPasswordToken = token
    user.resetPasswordExpires = Date.now() + 60 * 60 * 1000
    await user.save()

    const link = `${process.env.FRONTEND_URL}/resetar-senha/${token}`

    await axios.post(
      "https://api.brevo.com/v3/smtp/email",
      {
        sender: {
          name: "QuimITA",
          email: "no-reply@quimicavestibular.com.br"
        },
        to: [{ email: user.email }],
        subject: "Recuperação de senha - QuimITA",
        htmlContent: `
          <p>Você solicitou a recuperação de senha.</p>
          <p>Clique no link abaixo:</p>
          <a href="${link}">${link}</a>
        `
      },
      {
        headers: {
          "api-key": process.env.BREVO_API_KEY,
          "Content-Type": "application/json"
        }
      }
    )

    res.json({ ok: true })
  } catch (err) {
    console.error("❌ Erro forgot-password:", err.response?.data || err)
    res.status(500).json({ msg: "Erro ao enviar email" })
  }
})


// =======================
// RESETAR SENHA (TOKEN)
// =======================
app.post("/auth/reset-password/:token", async (req, res) => {
  try {
    const { senha } = req.body

    const user = await User.findOne({
      resetPasswordToken: req.params.token,
      resetPasswordExpires: { $gt: Date.now() }
    })

    if (!user) {
      return res.status(400).json({ msg: "Token inválido ou expirado" })
    }

    user.senha = await bcrypt.hash(senha, 12)
    user.resetPasswordToken = undefined
    user.resetPasswordExpires = undefined
    await user.save()

    res.json({ ok: true })
  } catch (err) {
    console.error("❌ Erro reset-password:", err)
    res.status(500).json({ msg: "Erro ao redefinir senha" })
  }
})

// =======================
// START
// =======================
const PORT = process.env.PORT || 3000
app.listen(PORT, "0.0.0.0", () =>
  console.log(`✅ Servidor rodando na porta ${PORT}`)
)
