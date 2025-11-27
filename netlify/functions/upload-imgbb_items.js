// netlify/functions/upload-imgbb.js
exports.handler = async function(event) {
  try {
    if (event.httpMethod !== "POST") {
      return { statusCode: 405, body: "Method Not Allowed" };
    }

    const body = JSON.parse(event.body || "{}");
    const base64Image = body.base64Image;

    if (!base64Image) {
      return { statusCode: 400, body: JSON.stringify({ error: "Missing base64Image" }) };
    }

    const API_KEY = process.env.IMGBB_API_KEY_items;

    const params = new URLSearchParams();
    params.append("image", base64Image);

    const response = await fetch(`https://api.imgbb.com/1/upload?key=${API_KEY}`, {
      method: "POST",
      body: params
    });

    const data = await response.json();

    return {
      statusCode: 200,
      body: JSON.stringify({
        url: data.data.url,
        deleteUrl: data.data.delete_url,
      })
    };
  } catch (err) {
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};
