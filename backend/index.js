require("dotenv").config(); // 👈 Carga las variables de entorno

const express = require("express");
const axios = require("axios");
const cors = require("cors");
const pool = require("./db");
const Joi = require("joi");
const jwt = require("jsonwebtoken");
const bcrypt = require("bcryptjs");

const app = express();
app.use(cors());
app.use(express.json());

const SECRET_KEY = process.env.JWT_SECRET || "supersecreto123";
const USER = process.env.USER;
const PASSWORD = process.env.PASSWORD;

const users = [
  { email: USER, passwordHash: bcrypt.hashSync(PASSWORD, 10) }
];

app.post("/api/login", async (req, res) => {
  const { error, value } = loginSchema.validate(req.body);
  if (error) return res.status(400).json({ error: error.details[0].message });

  const { email, password } = value;
  const user = users.find(u => u.email === email);

  if (!user || !bcrypt.compareSync(password, user.passwordHash)) {
    return res.status(401).json({ error: "Credenciales inválidas" });
  }

  const token = jwt.sign({ email }, SECRET_KEY, { expiresIn: "2h" });
  res.json({ token });
});


// Esquema de validación con Joi
const contactoSchema = Joi.object({
  recaptchaToken: Joi.string().required(),
  nombre: Joi.string().trim().min(2).max(100).required(),
  telefono: Joi.string()
    .trim()
    .pattern(/^[0-9\-\+\s]{7,20}$/)
    .required(),
  correo: Joi.string()
    .email({ tlds: { allow: false } })
    .required(),
  mensaje: Joi.string().trim().min(5).max(1000).required(),
  terminos: Joi.boolean().valid(true).required(),
});

const loginSchema = Joi.object({
  email: Joi.string()
    .trim()
    .email({ tlds: { allow: false } })
    .pattern(/^[^'"=*.;\s]+@[^'"=*.;\s]+\.[^'"=*.;\s]+$/)
    .required()
    .messages({
      "string.pattern.base": "El correo contiene caracteres no permitidos",
    }),
  password: Joi.string()
    .min(8)
    .max(100)
    .pattern(/^[^'"=*.;]+$/)
    .required()
    .messages({
      "string.pattern.base": "La contraseña contiene caracteres no permitidos",
    }),
});


app.post("/api/contacto", async (req, res) => {
  try {
    const { error, value } = contactoSchema.validate(req.body);
    if (error) return res.status(400).json({ error: error.details[0].message });

    const { recaptchaToken, nombre, telefono, correo, mensaje, terminos } = value;

    // Validar reCAPTCHA
    const verificationURL = `https://www.google.com/recaptcha/api/siteverify?secret=${process.env.RECAPTCHA_SECRET}&response=${recaptchaToken}`;
    const { data } = await axios.post(verificationURL);
    if (!data.success) return res.status(400).json({ error: "reCAPTCHA falló." });

    // Guardar en DB incluyendo estado = "nuevo"
    const sql = `
      INSERT INTO contactos (nombre, telefono, correo, mensaje, terminos, estado)
      VALUES (?, ?, ?, ?, ?, ?)
    `;
    await pool.query(sql, [nombre, telefono, correo, mensaje, terminos, "nuevo"]);

    // Enviar correo con Brevo
    await axios.post(
      "https://api.brevo.com/v3/smtp/email",
      {
        sender: { name: "Ladingpages", email: "joshgonzbv@gmail.com" }, // Cambia por tu correo
        to: [{ email: "joshgonzbv@gmail.com", name: "Destinatario" }], // Cambia al correo que recibirá leads
        subject: "Nuevo mensaje de contacto",
        htmlContent: `
          <h1>Nuevo lead desde la landing page</h1>
          <p><strong>Nombre:</strong> ${nombre}</p>
          <p><strong>Correo:</strong> ${correo}</p>
          <p><strong>Teléfono:</strong> ${telefono}</p>
          <p><strong>Mensaje:</strong> ${mensaje}</p>
        `
      },
      {
        headers: {
          "api-key": process.env.BREVO_API_KEY,
          "Content-Type": "application/json"
        }
      }
    );

    res.status(200).json({ mensaje: "Formulario enviado y correo notificado correctamente." });
  } catch (err) {
    console.error("Error en backend:", err.response?.data || err.message);
    res.status(500).json({ error: "Error en el servidor" });
  }
});

function verifyToken(req, res, next) {
  const token = req.headers.authorization?.split(" ")[1];
  if (!token) return res.status(403).json({ error: "Token requerido" });

  try {
    const decoded = jwt.verify(token, SECRET_KEY);
    req.user = decoded;
    next();
  } catch {
    res.status(401).json({ error: "Token inválido" });
  }
}

// Endpoint protegido para obtener leads
app.get("/api/leads", verifyToken, async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 5;
    const offset = (page - 1) * limit;

    console.log("Token OK. Consultando leads...");
    
    const [rows] = await pool.query(
      `SELECT * FROM contactos ORDER BY id DESC LIMIT ? OFFSET ?`,
      [limit, offset]
    );

    const [[{ total }]] = await pool.query(
      `SELECT COUNT(*) as total FROM contactos`
    );

    res.json({
      leads: rows,
      total,
      page,
      totalPages: Math.ceil(total / limit),
    });
  } catch (error) {
    console.error("🔥 ERROR en /api/leads:", error);
    res.status(500).json({ error: "Error en el servidor" });
  }
});



app.put("/api/leads/:id", verifyToken, async (req, res) => {
  const { id } = req.params;
  const { estado } = req.body;

  if (!["descartado", "contactado"].includes(estado)) {
    return res.status(400).json({ error: "Estado inválido" });
  }

  try {
    const sql = "UPDATE contactos SET estado = ? WHERE id = ?";
    const [result] = await pool.query(sql, [estado, id]);

    if (result.affectedRows === 0) {
      return res.status(404).json({ error: "Lead no encontrado" });
    }

    res.json({ mensaje: "Estado actualizado" });
  } catch (error) {
    console.error("Error al actualizar estado:", error);
    res.status(500).json({ error: "Error en el servidor" });
  }
});


// Escuchar en el puerto definido en el .env o por defecto en 3000
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Backend corriendo en http://localhost:${PORT}`);
});
