export function renderQrCode(container, value, size = 128) {
  if (!container) return;
  container.replaceChildren();

  if (window.QRCode) {
    new window.QRCode(container, {
      text: value,
      width: size,
      height: size,
      colorDark: "#102a43",
      colorLight: "#ffffff",
      correctLevel: window.QRCode.CorrectLevel?.M ?? 0,
    });
    return;
  }

  const image = document.createElement("img");
  image.width = size;
  image.height = size;
  image.alt = "QR Code";
  image.src = `https://api.qrserver.com/v1/create-qr-code/?size=${size}x${size}&data=${encodeURIComponent(value)}`;
  container.append(image);
}
