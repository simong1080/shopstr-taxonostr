import { useContext, useEffect, useState } from "react";
import useNavigation from "@/components/hooks/use-navigation";
import { Button, Image, useDisclosure } from "@heroui/react";
import { Bars4Icon } from "@heroicons/react/24/outline";
import { countNumberOfUnreadMessagesFromChatsContext } from "@/utils/messages/utils";
import {
  ChatsContext,
  ShopMapContext,
  SiteLanguageContext,
} from "@/utils/context/context";
import { SignerContext } from "@/components/utility-components/nostr-context-provider";
import { useRouter } from "next/router";
import SignInModal from "./sign-in/SignInModal";
import { ProfileWithDropdown } from "./utility-components/profile/profile-dropdown";
import { ShopProfile } from "../utils/types/types";
import { getLocalStorageJson } from "@/utils/safe-json";
import {
  RTL_SITE_LANGUAGES,
  SITE_LANGUAGE_OPTIONS,
  SiteLanguageCode,
} from "@/utils/i18n-config";
import { translateUi } from "@/utils/i18n-translations";

const TopNav = ({
  setFocusedPubkey,
  setSelectedSection,
}: {
  setFocusedPubkey: (value: string) => void;
  setSelectedSection: (value: string) => void;
}) => {
  const {
    isHomeActive,
    isProfileActive,
    isCommunitiesActive,
    isMessagesActive,
    isWalletActive,
    isMyListingsActive,
    isCartActive,
  } = useNavigation();
  const router = useRouter();

  const chatsContext = useContext(ChatsContext);
  const shopMapContext = useContext(ShopMapContext);
  const { siteLanguage, setSiteLanguage } = useContext(SiteLanguageContext);

  const [unreadMsgCount, setUnreadMsgCount] = useState(0);
  const [cartQuantity, setCartQuantity] = useState(0);
  const { isOpen, onOpen, onClose } = useDisclosure();
  const { isLoggedIn: signedIn, pubkey: userPubkey } =
    useContext(SignerContext);

  const [shopLogoURL, setShopLogoURL] = useState("");
  const [shopName, setShopName] = useState("");

  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const t = (key: string) => translateUi(siteLanguage, key);

  useEffect(() => {
    const fetchAndUpdateCartQuantity = async () => {
      const cartList = getLocalStorageJson<unknown[]>("cart", [], {
        removeOnError: true,
        validate: Array.isArray,
      });
      if (cartList.length > 0) {
        setCartQuantity(cartList.length);
      } else {
        setCartQuantity(0);
      }
    };

    fetchAndUpdateCartQuantity();

    const interval = setInterval(() => {
      fetchAndUpdateCartQuantity();
    }, 1000);

    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    const getUnreadMessages = async () => {
      const unreadMsgCount = await countNumberOfUnreadMessagesFromChatsContext(
        chatsContext.chatsMap
      );
      setUnreadMsgCount(unreadMsgCount);
    };
    getUnreadMessages();
  }, [chatsContext]);

  useEffect(() => {
    const npub = router.pathname
      .split("/")
      .find((segment) => segment.includes("npub1"));
    if (
      npub &&
      shopMapContext.shopData.has(npub) &&
      typeof shopMapContext.shopData.get(npub) != "undefined"
    ) {
      const shopProfile: ShopProfile | undefined =
        shopMapContext.shopData.get(npub);
      if (shopProfile) {
        setShopLogoURL(shopProfile.content.ui.picture);
        setShopName(shopProfile.content.name);
      }
    } else if (
      router.pathname.includes("my-listings") &&
      userPubkey &&
      shopMapContext.shopData.has(userPubkey) &&
      typeof shopMapContext.shopData.get(userPubkey) != "undefined"
    ) {
      const shopProfile: ShopProfile | undefined =
        shopMapContext.shopData.get(userPubkey);
      if (shopProfile) {
        setShopLogoURL(shopProfile.content.ui.picture);
        setShopName(shopProfile.content.name);
      }
    } else {
      setShopLogoURL("");
      setShopName("");
    }
  }, [router.pathname, shopMapContext, userPubkey]);

  const handleRoute = (path: string) => {
    if (signedIn) {
      router.push(path);
      setIsMobileMenuOpen(false);
    } else {
      onOpen();
    }
  };

  const handleHomeClick = () => {
    setFocusedPubkey("");
    setSelectedSection("");
    router.push("/marketplace");
    setIsMobileMenuOpen(false);
  };

  const languageSelector = (className: string = "") => (
    <label
      className={`text-light-text dark:text-dark-text flex min-w-0 items-center gap-2 text-sm ${className}`.trim()}
    >
      <span className="hidden lg:inline">{t("Language")}</span>
      <select
        aria-label={t("Language")}
        value={siteLanguage}
        dir={RTL_SITE_LANGUAGES.has(siteLanguage) ? "rtl" : "ltr"}
        onChange={(event) =>
          setSiteLanguage(event.target.value as SiteLanguageCode)
        }
        className="w-full max-w-40 min-w-0 rounded-md border border-zinc-300 bg-transparent px-2 py-1 text-sm outline-none dark:border-zinc-700"
      >
        {SITE_LANGUAGE_OPTIONS.map((option) => (
          <option key={option.code} value={option.code}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );

  const MobileMenu = () => (
    <div className="bg-light-fg dark:bg-dark-fg absolute top-full left-0 w-full shadow-lg">
      <Button
        className="text-light-text dark:text-dark-text dark:hover:text-accent-dark-text w-full bg-transparent hover:text-purple-700"
        onClick={handleHomeClick}
      >
        Marketplace
      </Button>
      <Button
        className="text-light-text dark:text-dark-text dark:hover:text-accent-dark-text w-full bg-transparent hover:text-purple-700"
        onClick={() => {
          router.push("/communities");
          setIsMobileMenuOpen(false);
        }}
      >
        Communities
      </Button>
      <Button
        className="text-light-text dark:text-dark-text dark:hover:text-accent-dark-text w-full bg-transparent hover:text-purple-700"
        onClick={() => handleRoute("/orders")}
      >
        Orders
        {unreadMsgCount > 0 && (
          <span className="bg-shopstr-purple dark:bg-shopstr-yellow dark:text-dark-bg ml-1 inline-flex h-5 min-w-5 items-center justify-center rounded-full px-1.5 text-xs font-bold text-white">
            {unreadMsgCount}
          </span>
        )}
      </Button>
      <Button
        className="text-light-text dark:text-dark-text dark:hover:text-accent-dark-text w-full bg-transparent hover:text-purple-700"
        onClick={() => handleRoute("/wallet")}
      >
        Wallet
      </Button>
      <Button
        className="text-light-text dark:text-dark-text dark:hover:text-accent-dark-text w-full bg-transparent hover:text-purple-700"
        onClick={() => handleRoute("/my-listings")}
      >
        My Listings
      </Button>
      <Button
        className="text-light-text dark:text-dark-text dark:hover:text-accent-dark-text w-full bg-transparent hover:text-purple-700"
        onClick={() => handleRoute("/cart")}
      >
        Cart
        {cartQuantity > 0 && (
          <span className="bg-shopstr-purple dark:bg-shopstr-yellow dark:text-dark-bg ml-1 inline-flex h-5 min-w-5 items-center justify-center rounded-full px-1.5 text-xs font-bold text-white">
            {cartQuantity}
          </span>
        )}
      </Button>
    </div>
  );

  return (
    <div
      data-main-nav
      className="bg-light-fg dark:bg-dark-fg fixed top-0 z-50 w-full border-b border-zinc-200 shadow-lg dark:border-zinc-800"
    >
      <div className="flex items-center py-2 pr-4">
        <div className="flex flex-shrink-0 items-center">
          <Button
            onClick={handleHomeClick}
            className={`text-light-text dark:text-dark-text dark:hover:text-accent-dark-text flex items-center bg-transparent duration-200 hover:text-purple-700`}
          >
            <Image
              alt="Shopstr logo"
              height={40}
              radius="sm"
              src={shopLogoURL != "" ? shopLogoURL : "/shopstr-2000x2000.png"}
              width={40}
            />
            <span
              className={`ml-2 text-xl md:hidden lg:flex ${
                isHomeActive ? "font-bold" : ""
              }`}
            >
              {shopName != "" ? shopName : "Shopstr"}
            </span>
          </Button>
        </div>
        <div className="ml-auto flex min-w-0 flex-row items-center gap-1 md:hidden">
          {languageSelector("max-w-[8.5rem] shrink")}
          <Button
            isIconOnly
            className="min-w-10 shrink-0 bg-transparent"
            onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
          >
            <Bars4Icon className="text-light-text dark:text-dark-text h-6 w-6" />
          </Button>
          {signedIn ? (
            <ProfileWithDropdown
              pubkey={userPubkey!}
              baseClassname="flex-shrink-0 dark:hover:shopstr-yellow-light rounded-3xl hover:scale-105 hover:bg-light-bg hover:shadow-lg dark:hover:bg-dark-bg"
              dropDownKeys={[
                "shop_profile",
                "user_profile",
                "settings",
                "logout",
              ]}
              nameClassname="hidden"
            />
          ) : (
            <Button
              onClick={onOpen}
              className="text-light-text dark:text-dark-text dark:hover:text-accent-dark-text bg-transparent hover:text-purple-700"
            >
              Sign In
            </Button>
          )}
        </div>
        <div className="text-light-text dark:text-dark-text hidden flex-1 items-center justify-evenly md:flex">
          <Button
            className={`dark:hover:text-accent-dark-text bg-transparent hover:text-purple-700 ${
              isHomeActive
                ? "text-shopstr-purple dark:text-shopstr-yellow font-bold"
                : "text-light-text dark:text-dark-text"
            }`}
            onClick={handleHomeClick}
          >
            Marketplace
          </Button>
          <Button
            className={`dark:hover:text-accent-dark-text bg-transparent hover:text-purple-700 ${
              isCommunitiesActive
                ? "text-shopstr-purple dark:text-shopstr-yellow font-bold"
                : "text-light-text dark:text-dark-text"
            }`}
            onClick={() => router.push("/communities")}
          >
            Communities
          </Button>
          <Button
            className={`dark:hover:text-accent-dark-text bg-transparent hover:text-purple-700 ${
              isMessagesActive
                ? "text-shopstr-purple dark:text-shopstr-yellow font-bold"
                : "text-light-text dark:text-dark-text"
            }`}
            onClick={() => handleRoute("/orders")}
          >
            Orders
            {unreadMsgCount > 0 && (
              <span className="bg-shopstr-purple dark:bg-shopstr-yellow dark:text-dark-bg ml-1 inline-flex h-5 min-w-5 items-center justify-center rounded-full px-1.5 text-xs font-bold text-white">
                {unreadMsgCount}
              </span>
            )}
          </Button>
          <Button
            className={`dark:hover:text-accent-dark-text bg-transparent hover:text-purple-700 ${
              isWalletActive
                ? "text-shopstr-purple dark:text-shopstr-yellow font-bold"
                : "text-light-text dark:text-dark-text"
            }`}
            onClick={() => handleRoute("/wallet")}
          >
            Wallet
          </Button>
          <Button
            className={`dark:hover:text-accent-dark-text bg-transparent hover:text-purple-700 ${
              isMyListingsActive
                ? "text-shopstr-purple dark:text-shopstr-yellow font-bold"
                : "text-light-text dark:text-dark-text"
            }`}
            onClick={() => handleRoute("/my-listings")}
          >
            My Listings
          </Button>
          <Button
            className={`dark:hover:text-accent-dark-text bg-transparent hover:text-purple-700 ${
              isCartActive
                ? "text-shopstr-purple dark:text-shopstr-yellow font-bold"
                : "text-light-text dark:text-dark-text"
            }`}
            onClick={() => handleRoute("/cart")}
          >
            Cart
            {cartQuantity > 0 && (
              <span className="bg-shopstr-purple dark:bg-shopstr-yellow dark:text-dark-bg ml-1 inline-flex h-5 min-w-5 items-center justify-center rounded-full px-1.5 text-xs font-bold text-white">
                {cartQuantity}
              </span>
            )}
          </Button>
        </div>
        <div className="hidden flex-shrink-0 items-center gap-3 md:flex">
          {languageSelector()}
          {signedIn ? (
            <ProfileWithDropdown
              pubkey={userPubkey!}
              baseClassname="justify-start dark:hover:shopstr-yellow-light pl-2 rounded-3xl py-2 hover:scale-105 hover:bg-light-bg hover:shadow-lg dark:hover:bg-dark-bg"
              dropDownKeys={[
                "shop_profile",
                "user_profile",
                "settings",
                "logout",
              ]}
              nameClassname="lg:block"
            />
          ) : (
            <Button
              onClick={onOpen}
              className={`dark:hover:text-accent-dark-text bg-transparent duration-200 hover:text-purple-700 ${
                isProfileActive
                  ? "text-shopstr-purple dark:text-shopstr-yellow font-bold"
                  : "text-light-text dark:text-dark-text"
              }`}
            >
              Sign In
            </Button>
          )}
        </div>
      </div>
      {isMobileMenuOpen && <MobileMenu />}
      <SignInModal isOpen={isOpen} onClose={onClose} />
    </div>
  );
};

export default TopNav;
