import { useState } from "react";
import "./styles.css";

type Screen = "territory" | "restaurant" | "embankment";

function App() {
  const [screen, setScreen] = useState<Screen>("territory");

  return (
    <div className="app">
      {screen === "territory" && (
        <section className="map-screen">
          <img
            src="/maps/territory-bg.png"
            alt="Територія ресторану"
            className="map-image"
          />

          <button
            className="map-button restaurant-button"
            onClick={() => setScreen("restaurant")}
          >
            Ресторан
          </button>

          <button
            className="map-button embankment-button"
            onClick={() => setScreen("embankment")}
          >
            Набережна
          </button>
        </section>
      )}

      {screen === "restaurant" && (
        <section className="place-screen">
          <button className="back-button" onClick={() => setScreen("territory")}>
            ← Назад
          </button>

          <h1>Ресторан</h1>
          <p>Тут буде схема залу зі столами.</p>
        </section>
      )}

      {screen === "embankment" && (
        <section className="place-screen">
          <button className="back-button" onClick={() => setScreen("territory")}>
            ← Назад
          </button>

          <h1>Набережна</h1>
          <p>Тут буде схема столів на набережній.</p>
        </section>
      )}
    </div>
  );
}

export default App;
