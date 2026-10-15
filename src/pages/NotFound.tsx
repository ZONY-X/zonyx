import { useLocation } from "react-router-dom";
import { useEffect } from "react";

const NotFound = () => {
  const location = useLocation();

  useEffect(() => {
    const previousTitle = document.title;
    document.title = "Page Not Found | ZONYX";
    const existingRobots = document.head.querySelector<HTMLMetaElement>('meta[name="robots"]');
    const previousRobots = existingRobots?.content;
    const robots = existingRobots || document.createElement("meta");
    robots.name = "robots";
    robots.content = "noindex, follow";
    if (!existingRobots) document.head.appendChild(robots);
    // Only log in development to avoid exposing route enumeration attempts
    if (import.meta.env.DEV) {
      console.error("404 Error: User attempted to access non-existent route:", location.pathname);
    }
    return () => {
      document.title = previousTitle;
      if (existingRobots) robots.content = previousRobots || "";
      else robots.remove();
    };
  }, [location.pathname]);

  return (
    <div className="zonyx-fleet zonyx-app flex min-h-screen items-center justify-center bg-muted">
      <div className="text-center">
        <h1 className="mb-4 text-4xl font-bold">404</h1>
        <p className="mb-4 text-xl text-muted-foreground">Oops! Page not found</p>
        <a href="/" className="text-primary underline hover:text-primary/90">
          Return to Home
        </a>
      </div>
    </div>
  );
};

export default NotFound;
