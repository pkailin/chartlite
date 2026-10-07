import Chart from './map/Chart';

/**
 * One tab, one chart.
 *
 * The bar carries the tool's name and nothing else. It is NOT a tab strip
 * waiting to be filled — when a second surface arrives it will need a real
 * decision about navigation, and leaving a hollow one here would pre-empt
 * that decision by looking like it had already been made.
 */
export default function App() {
  return (
    <div className="app">
      <header className="bar">
        <span className="bar-name">CHARTLITE</span>
        <span className="bar-where">Singapore Strait</span>
      </header>
      <main className="stage">
        <Chart />
      </main>
    </div>
  );
}
