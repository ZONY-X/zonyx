import { useState } from "react";
import { Calendar, MapPin, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar as CalendarComponent } from "@/components/ui/calendar";
import { format } from "date-fns";
import { useNavigate } from "react-router-dom";
import { useLanguage } from "@/contexts/LanguageContext";

const ZONYX_SERVICE_AREAS = [
  "Coconut Grove",
  "Brickell",
  "Downtown Miami",
  "Wynwood",
  "Miami Beach",
  "Coral Gables",
  "Edgewater",
  "Miami International Airport",
] as const;

export function SearchForm() {
  const navigate = useNavigate();
  const {
    t
  } = useLanguage();
  const [location, setLocation] = useState("");
  const [pickupDate, setPickupDate] = useState<Date>();
  const [returnDate, setReturnDate] = useState<Date>();
  const [pickupTime, setPickupTime] = useState("10:00");
  const [dropoffTime, setDropoffTime] = useState("10:00");
  const handleSearch = () => {
    const params = new URLSearchParams();
    if (location) params.set("location", location);
    if (pickupDate) params.set("pickup", pickupDate.toISOString());
    if (returnDate) params.set("return", returnDate.toISOString());
    params.set("pickupTime", pickupTime);
    params.set("dropoffTime", dropoffTime);
    navigate(`/fleet?${params.toString()}`);
  };
  return <div className="bg-card/15 backdrop-blur-sm border border-border/30 rounded-2xl p-4 md:p-6 w-full max-w-[90%] md:max-w-4xl mx-auto">
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        {/* Location */}
        <div className="relative">
          <label className="text-xs font-medium mb-1.5 block text-primary">{t("search.location")}</label>
          <div className="relative">
            <MapPin className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <select aria-label={t("search.location")} value={location} onChange={event => setLocation(event.target.value)} className="flex h-10 w-full rounded-md border border-border bg-secondary pl-10 pr-3 text-sm text-foreground">
              <option value="">{t("search.pickupLocation")}</option>
              {ZONYX_SERVICE_AREAS.map(area => <option key={area} value={area}>{area}</option>)}
            </select>
          </div>
        </div>

        {/* Pickup Date */}
        <div>
          <label className="text-xs font-medium mb-1.5 block text-primary">{t("search.pickupDate")}</label>
          <Popover>
            <PopoverTrigger asChild>
              <Button variant="outline" className="w-full justify-start text-left font-normal bg-secondary border-border">
                <Calendar className="mr-2 h-4 w-4 text-muted-foreground" />
                {pickupDate ? format(pickupDate, "MMM d, yyyy") : <span className="text-muted-foreground">{t("search.selectDate")}</span>}
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-0" align="start">
              <CalendarComponent mode="single" selected={pickupDate} onSelect={setPickupDate} disabled={date => date < new Date()} initialFocus />
            </PopoverContent>
          </Popover>
          <Input aria-label="Pickup time" type="time" value={pickupTime} onChange={event => setPickupTime(event.target.value)} className="mt-2 bg-secondary border-border" />
        </div>

        {/* Return Date */}
        <div>
          <label className="text-xs font-medium mb-1.5 block text-primary">{t("search.returnDate")}</label>
          <Popover>
            <PopoverTrigger asChild>
              <Button variant="outline" className="w-full justify-start text-left font-normal bg-secondary border-border">
                <Calendar className="mr-2 h-4 w-4 text-muted-foreground" />
                {returnDate ? format(returnDate, "MMM d, yyyy") : <span className="text-muted-foreground">{t("search.selectDate")}</span>}
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-0" align="start">
              <CalendarComponent mode="single" selected={returnDate} onSelect={setReturnDate} disabled={date => date <= (pickupDate || new Date())} initialFocus />
            </PopoverContent>
          </Popover>
          <Input aria-label="Drop-off time" type="time" value={dropoffTime} onChange={event => setDropoffTime(event.target.value)} className="mt-2 bg-secondary border-border" />
        </div>

        {/* Search Button */}
        <div className="flex items-end">
          <Button size="lg" className="w-full" onClick={handleSearch}>
            <Search className="w-4 h-4 mr-2" />
            {t("search.search")}
          </Button>
        </div>
      </div>
    </div>;
}