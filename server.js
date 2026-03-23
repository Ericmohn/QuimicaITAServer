require("dotenv").config()
const express = require("express")
const mongoose = require("mongoose")
const bcrypt = require("bcryptjs")
const jwt = require("jsonwebtoken")
const cors = require("cors")
const crypto = require("crypto")
const axios = require("axios")
const cron = require("cron")
const https = require("https")

const User = require("./models/User")
const { MercadoPagoConfig, PreApproval } = require("mercadopago")

const app = express()

app.use(cors({ origin: process.env.FRONTEND_URL, credentials: true }))
app.use(express.json())

// =======================
// MONGODB
// =======================
mongoose.connect(process.env.MONGO_URI)
  .then(() => console.log("✅ MongoDB conectado"))
  .catch(err => console.error(err))

// =======================
// MERCADO PAGO
// =======================
const mpClient = new MercadoPagoConfig({
  accessToken: process.env.MERCADOPAGO_ACCESS_TOKEN
})
const preApproval = new PreApproval(mpClient)

// =======================
// JWT
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
// AUTH
// =======================
app.post("/auth/login", async (req, res) => {
  try {
    const { email, senha } = req.body
    const user = await User.findOne({ email })

    if (!user) return res.status(404).json({ msg: "Usuário não encontrado" })

    const ok = await bcrypt.compare(senha, user.senha)
    if (!ok) return res.status(401).json({ msg: "Senha inválida" })

    const token = jwt.sign({ id: user._id }, process.env.SECRET, { expiresIn: "1d" })
    res.json({ token })
  } catch (err) {
    res.status(500).json({ msg: "Erro interno" })
  }
})

// =======================
// PERFIL (UNIFICADO)
// =======================
app.get("/user/perfil", checkToken, async (req, res) => {
  try {
    const user = await User.findById(req.user.id).select("-senha")

    // 🔥 ISENTO (ADMIN / TESTER)
    if (["admin", "tester"].includes(user.role)) {
      return res.json({
        ...user.toObject(),
        assinatura: true,
        assinaturaStatus: "active"
      })
    }

    // 🔥 USUÁRIO NORMAL (SINCRONIZA COM MP)
    if (user.assinaturaId) {
      const mpData = await preApproval.get({ id: user.assinaturaId })

      console.log("MP STATUS:", mpData.status)

      if (mpData.status === "authorized") {
        user.assinatura = true
        user.assinaturaStatus = "active"
      } else if (["paused", "cancelled"].includes(mpData.status)) {
        user.assinatura = false
        user.assinaturaStatus = "inactive"
      } else {
        user.assinaturaStatus = "pending"
      }

      user.assinaturaAtualizadaEm = new Date()
      await user.save()
    }

    res.json(user)
  } catch (err) {
    res.status(500).json({ msg: "Erro interno" })
  }
})
// =======================
// CRIAR ASSINATURA
// =======================
app.post("/assinatura", checkToken, async (req, res) => {
  try {
    const user = await User.findById(req.user.id)

    const response = await preApproval.create({
      body: {
        reason: "Assinatura Mensal",
        payer_email: user.email,
        auto_recurring: {
          frequency: 1,
          frequency_type: "months",
          transaction_amount: 40,
          currency_id: "BRL"
        },
        back_url: `${process.env.FRONTEND_URL}/sucesso`,
        notification_url: `${process.env.API_URL}/webhook/mercadopago`,
        external_reference: user._id.toString()
      }
    })

    user.assinaturaId = response.id
    user.assinaturaStatus = "pending"
    user.assinatura = false
    await user.save()

    res.json({ init_point: response.init_point })
  } catch (err) {
    console.error(err)
    res.status(500).json({ msg: "Erro ao criar assinatura" })
  }
})

// =======================
// WEBHOOK CORRIGIDO
// =======================
app.post("/webhook/mercadopago", async (req, res) => {
  try {
    const id = req.body?.data?.id
    if (!id) return res.sendStatus(200)

    const mpData = await preApproval.get({ id })
    const user = await User.findOne({ assinaturaId: id })

    if (!user) return res.sendStatus(200)

    console.log("Webhook status:", mpData.status)

    if (mpData.status === "authorized") {
      user.assinatura = true
      user.assinaturaStatus = "active"
    }

    if (["paused", "cancelled"].includes(mpData.status)) {
      user.assinatura = false
      user.assinaturaStatus = "inactive"
    }

    if (mpData.status === "pending") {
      user.assinaturaStatus = "pending"
    }

    await user.save()

    res.sendStatus(200)
  } catch (err) {
    console.error("Webhook erro:", err)
    res.sendStatus(500)
  }
})

// =======================
// KEEP RENDER ALIVE
// =======================
if (process.env.NODE_ENV === "production") {
  const job = new cron.CronJob("*/10 * * * *", function () {
    https.get(`${process.env.API_URL}/api/health`)
  })
  job.start()
}

// =======================
// START SERVER
// =======================
const PORT = process.env.PORT || 3000
app.listen(PORT, () => console.log("Servidor rodando"))
