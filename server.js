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

// =======================
// START LOGS
// =======================
console.log("🚀 Server iniciado")
console.log("NODE_ENV:", process.env.NODE_ENV)
console.log("FRONTEND_URL:", process.env.FRONTEND_URL)

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
// HEALTH
// =======================
app.get("/api/health", (_, res) => {
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
  .catch(err => console.error("❌ MongoDB erro:", err))

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
app.post("/auth/register", async (req, res) => {
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
    assinaturaStatus: "inactive",
    assinaturaEmProcesso: false
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
// ASSINATURA (CRIAR)
// =======================
app.post("/assinatura", checkToken, async (req, res) => {
  const user = await User.findById(req.user.id)

  const payload = {
    reason: "Assinatura Mensal - QuimicaVestibular",
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


  const response = await preApproval.create({ body: payload })

  user.assinaturaId = response.id
  user.assinaturaStatus = "pending"
  user.assinaturaEmProcesso = true
  user.assinatura = false
  await user.save()

  res.json({ init_point: response.init_point })
})

// =======================
// VERIFICAR ASSINATURA
// =======================
app.post("/user/verifica-assinatura", checkToken, async (req, res) => {
  const user = await User.findById(req.user.id)

  res.json({
    assinatura: user.assinatura === true,
    status: user.assinaturaStatus
  })
})

// =======================
// CANCELAR ASSINATURA
// =======================
app.post("/assinatura/cancelar", checkToken, async (req, res) => {
  const user = await User.findById(req.user.id)

  if (!user?.assinaturaId) {
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
// REATIVAR ASSINATURA
// =======================
app.post("/assinatura/reativar", checkToken, async (req, res) => {
  const user = await User.findById(req.user.id)

  if (user.assinaturaStatus === "pending") {
    return res.status(400).json({
      msg: "Pagamento já está em processamento"
    })
  }

  const payload = {
    reason: "Assinatura Mensal - QuimITA",
    payer_email: user.email,
    auto_recurring: {
      frequency: 1,
      frequency_type: "months",
      transaction_amount: 40,
      currency_id: "BRL"
    },
    back_url: `${process.env.FRONTEND_URL}/assinatura`,
    external_reference: user._id.toString()
  }

  const response = await preApproval.create({ body: payload })

  user.assinaturaId = response.id
  user.assinaturaStatus = "active"
  user.assinaturaEmProcesso = true
  user.assinatura = false
  await user.save()

  res.json({ init_point: response.init_point })
})

// =======================
// WEBHOOK MERCADO PAGO
// =======================
app.post("/webhook/mercadopago", async (req, res) => {
  try {
    const { type, data } = req.body

    if (type !== "preapproval.updated") {
      return res.sendStatus(200)
    }

    // 1️⃣ Buscar assinatura atualizada no MP
    const preapprovalData = await preApproval.get({ id: data.id })

    // 2️⃣ Encontrar usuário
    const user = await User.findOne({ assinaturaId: data.id })
    if (!user) return res.sendStatus(200)

    // 3️⃣ Atualizar status corretamente
    if (preapprovalData.status === "authorized") {
      user.assinatura = true
      user.assinaturaStatus = "active"
      user.assinaturaEmProcesso = false
    }

    if (preapprovalData.status === "pending") {
      user.assinaturaStatus = "pending"
    }

    if (["paused", "cancelled"].includes(preapprovalData.status)) {
      user.assinatura = false
      user.assinaturaStatus = "inactive"
      user.assinaturaEmProcesso = false
    }

    user.assinaturaAtualizadaEm = new Date()
    await user.save()

    res.sendStatus(200)
  } catch (err) {
    console.error("❌ Webhook erro:", err)
    res.sendStatus(500)
  }
})

// =======================
// ESQUECI MINHA SENHA
// =======================
app.post("/auth/forgot-password", async (req, res) => {
  const { email } = req.body
  const user = await User.findOne({ email })
  if (!user) return res.json({ ok: true })

  const token = crypto.randomBytes(32).toString("hex")

  user.resetPasswordToken = token
  user.resetPasswordExpires = Date.now() + 3600000
  await user.save()

  const link = `${process.env.FRONTEND_URL}/resetar-senha/${token}`

  await axios.post(
    "https://api.brevo.com/v3/smtp/email",
    {
      sender: { name: "QuimITA", email: "no-reply@quimicavestibular.com.br" },
      to: [{ email: user.email }],
      subject: "Recuperação de senha",
      htmlContent: `<p>Clique no link:</p><a href="${link}">${link}</a>`
    },
    {
      headers: {
        "api-key": process.env.BREVO_API_KEY,
        "Content-Type": "application/json"
      }
    }
  )

  res.json({ ok: true })
})

// =======================
// RESETAR SENHA
// =======================
app.post("/auth/reset-password/:token", async (req, res) => {
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
})
//========================
//VERIFICAÇÂO DE STATUS
//========================
app.get("/user/perfil", checkToken, async (req, res) => {
  const user = await User.findById(req.user.id).select("-senha")

  if (
    user.assinaturaStatus === "pending" &&
    user.assinaturaId
  ) {
    const mpData = await preApproval.get({ id: user.assinaturaId })

    if (mpData.status === "authorized") {
      user.assinatura = true
      user.assinaturaStatus = "active"
      user.assinaturaEmProcesso = false
      await user.save()
    }
  }

  res.json(user)
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
app.listen(PORT, "0.0.0.0", () =>
  console.log(`✅ Servidor rodando na porta ${PORT}`)
)
