import { RouterProvider } from "react-router-dom";

import { AuthProvider } from "./lib/auth";
import { AppQueryProvider } from "./lib/query";
import { ThemeProvider } from "./lib/theme";
import { router } from "./routes/router";

const App = () => (
  <ThemeProvider>
    <AuthProvider>
      <AppQueryProvider>
        <RouterProvider router={router} />
      </AppQueryProvider>
    </AuthProvider>
  </ThemeProvider>
);

export default App;
