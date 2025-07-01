require("dotenv").config(); // 👈 Carga las variables de entorno

const express = require("express");
const axios = require("axios");
const cors = require("cors");
const pool = require("./db");
const Joi = require("joi");

const app = express();
app.use(cors());
app.use(express.json());

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

app.post("/api/contacto", async (req, res) => {
  try {
    const { error, value } = contactoSchema.validate(req.body);
    if (error) {
      return res.status(400).json({ error: error.details[0].message });
    }

    const { recaptchaToken, nombre, telefono, correo, mensaje, terminos } =
      value;
    console.log("Datos recibidos:", value);

    // Validar reCAPTCHA con Google usando la variable del .env
    const verificationURL = `https://www.google.com/recaptcha/api/siteverify?secret=${process.env.RECAPTCHA_SECRET}&response=${recaptchaToken}`;
    const { data } = await axios.post(verificationURL);

    if (!data.success) {
      return res
        .status(400)
        .json({ error: "reCAPTCHA falló. Intenta nuevamente." });
    }

    // Insertar en base de datos
    const sql = `
      INSERT INTO contactos (nombre, telefono, correo, mensaje, terminos)
      VALUES (?, ?, ?, ?, ?)
    `;

    await pool.query(sql, [nombre, telefono, correo, mensaje, terminos]);

    res.status(200).json({ mensaje: "Formulario guardado con éxito" });
  } catch (error) {
    console.error("Error en backend:", error);
    res.status(500).json({ error: "Error en el servidor" });
  }
});

// Escuchar en el puerto definido en el .env o por defecto en 3000
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Backend corriendo en http://localhost:${PORT}`);
});
